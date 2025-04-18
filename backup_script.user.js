// ==UserScript==
// @name         F-List IndexedDB Auto Backup and Restore (Compressed, Date and Keys)
// @namespace    http://tampermonkey.net/
// @version      3.5
// @description  Backs up f-list chat logs IndexedDB to .json.gz, and restores data in case of total loss.
// @author       Grok
// @match        https://www.f-list.net/chat3/*
// @require      https://unpkg.com/pako@2.1.0/dist/pako.min.js
// @grant        GM_download
// ==/UserScript==

(async function() {
    'use strict';

    try {
        if (typeof GM.download !== 'function') throw new Error('GM.download not supported; update Tampermonkey');
        if (typeof pako === 'undefined') throw new Error('pako library not loaded');

        async function isIndexedDBEmpty() {
            const databases = await indexedDB.databases();
            if (!databases.length) return true;
            for (const dbInfo of databases) {
                if (!dbInfo.name) continue;
                const db = await new Promise((resolve, reject) => {
                    const openRequest = indexedDB.open(dbInfo.name);
                    openRequest.onsuccess = () => resolve(openRequest.result);
                    openRequest.onerror = () => reject(openRequest.error);
                });
                const storeNames = Array.from(db.objectStoreNames);
                for (const storeName of storeNames) {
                    const transaction = db.transaction([storeName], 'readonly');
                    const store = transaction.objectStore(storeName);
                    const count = await new Promise((resolve, reject) => {
                        const countRequest = store.count();
                        countRequest.onsuccess = () => resolve(countRequest.result);
                        countRequest.onerror = () => reject(countRequest.error);
                    });
                    if (count > 0) {
                        db.close();
                        return false;
                    }
                }
                db.close();
            }
            return true;
        }

        async function restoreIndexedDB(backupFile) {
            try {
                const compressedData = await backupFile.arrayBuffer();
                const decompressedData = pako.ungzip(compressedData, { to: 'string' });
                const backupData = JSON.parse(decompressedData);
                for (const dbName in backupData) {
                    const openRequest = indexedDB.open(dbName);
                    openRequest.onupgradeneeded = (event) => {
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains('conversations')) {
                            db.createObjectStore('conversations', { autoIncrement: true });
                        }
                        if (!db.objectStoreNames.contains('logs')) {
                            const logsStore = db.createObjectStore('logs', { autoIncrement: true });
                            logsStore.createIndex('conversation', 'conversation', { unique: false });
                            logsStore.createIndex('conversation-day', ['conversation', 'day'], { unique: false });
                        }
                    };
                    const db = await new Promise((resolve, reject) => {
                        openRequest.onsuccess = () => resolve(openRequest.result);
                        openRequest.onerror = () => reject(openRequest.error);
                    });
                    for (const storeName of ['conversations', 'logs']) {
                        if (!backupData[dbName][storeName]) continue;
                        const transaction = db.transaction([storeName], 'readwrite');
                        const store = transaction.objectStore(storeName);
                        await new Promise((resolve, reject) => {
                            const clearRequest = store.clear();
                            clearRequest.onsuccess = () => resolve();
                            clearRequest.onerror = () => reject(clearRequest.error);
                        });
                        for (let record of backupData[dbName][storeName]) {
                            if (!record) {
                                console.warn(`Skipping invalid record in ${storeName}:`, record);
                                continue;
                            }
                            // Convert time to Date for logs
                            if (storeName === 'logs' && typeof record.time === 'string') {
                                record = { ...record, time: new Date(record.time) };
                            }
                            await new Promise((resolve, reject) => {
                                const addRequest = storeName === 'logs' && record.id !== undefined ? store.add(record, record.id) : store.add(record);
                                addRequest.onsuccess = () => resolve();
                                addRequest.onerror = () => reject(addRequest.error);
                            });
                        }
                    }
                    db.close();
                }
                console.log('IndexedDB restored successfully');
            } catch (error) {
                console.error('Error restoring IndexedDB:', error);
                throw error;
            }
        }

        function createRestoreButton() {
            const button = document.createElement('button');
            button.textContent = 'Restore f-list.net Data from Backup';
            button.style.position = 'fixed';
            button.style.top = '10px';
            button.style.right = '10px';
            button.style.zIndex = '9999';
            button.style.padding = '10px';
            button.style.backgroundColor = '#007bff';
            button.style.color = 'white';
            button.style.border = 'none';
            button.style.borderRadius = '5px';
            button.style.cursor = 'pointer';
            button.addEventListener('click', () => {
                console.log('User clicked restore button');
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json.gz';
                input.onchange = async () => {
                    if (input.files.length) {
                        try {
                            await restoreIndexedDB(input.files[0]);
                            button.remove();
                            alert('Data restored successfully!.');
                        } catch (error) {
                            alert('Failed to restore data. Check Console.');
                        }
                    }
                };
                input.click();
            });
            document.body.appendChild(button);
            console.log('Restore button added');
        }

        if (await isIndexedDBEmpty()) {
            console.log('IndexedDB is empty; showing restore button');
            createRestoreButton();
        }

        const lastBackup = localStorage.getItem('lastBackup');
        const now = Date.now();
        if (lastBackup && now - parseInt(lastBackup) < 24 * 60 * 60 * 1000) {
            console.log('Backup skipped; last backup within 24 hours');
            return;
        }

        const origin = 'f-list.net';
        const databases = await indexedDB.databases();
        if (!databases.length) {
            console.log('No IndexedDB databases to back up');
            return;
        }

        const backupData = {};
        for (const dbInfo of databases) {
            if (!dbInfo.name) continue;
            const openRequest = indexedDB.open(dbInfo.name);
            const db = await new Promise((resolve, reject) => {
                openRequest.onsuccess = () => resolve(openRequest.result);
                openRequest.onerror = () => reject(openRequest.error);
            });

            backupData[dbInfo.name] = { conversations: [], logs: [] };
            const storeNames = Array.from(db.objectStoreNames);
            const storePromises = storeNames.map(async storeName => {
                try {
                    const transaction = db.transaction([storeName], 'readonly');
                    const store = transaction.objectStore(storeName);
                    const records = await new Promise((resolve, reject) => {
                        const getRequest = store.getAll();
                        getRequest.onsuccess = () => resolve(getRequest.result);
                        getRequest.onerror = () => reject(getRequest.error);
                    });
                    backupData[dbInfo.name][storeName] = records;
                } catch (storeError) {
                    console.error(`Error backing up store ${storeName} in ${dbInfo.name}:`, storeError);
                }
            });

            await Promise.all(storePromises);
            db.close();
        }

        const jsonData = JSON.stringify(backupData, null, 2);
        const compressedData = pako.gzip(jsonData);
        console.log(`Compressed data size: ${compressedData.length} bytes`);
        const blob = new Blob([compressedData], { type: 'application/gzip' });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString();
        const filename = `${origin}_backup_${timestamp}.json.gz`;

        const downloadPromise = GM.download({
            url,
            name: filename,
            saveAs: false
        }).then(details => `Download succeeded for ${filename}: ${JSON.stringify(details)}`)
          .catch(error => Promise.reject(new Error(`Download failed: ${error.message || JSON.stringify(error)}`)));

        const timeoutPromise = new Promise((resolve, reject) => {
            setTimeout(() => {
                if (downloadPromise && typeof downloadPromise.abort === 'function') {
                    downloadPromise.abort();
                    reject(new Error('Download aborted after 10 seconds'));
                }
            }, 10000);
        });

        try {
            const result = await Promise.race([downloadPromise, timeoutPromise]);
            console.log(result);
            localStorage.setItem('lastBackup', now);
        } catch (error) {
            console.error(error);
        } finally {
            URL.revokeObjectURL(url);
        }
    } catch (error) {
        console.error('Error during IndexedDB backup or restoration:', error);
    }
})();