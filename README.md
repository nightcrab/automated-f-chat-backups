# automated-f-chat-backups
Tampermonkey userscript that allows you to save f-list chat logs and then automatically restore them in case you lose your logs.

# Setup
1. Install Tampermonkey (https://www.tampermonkey.net/)
3. Create a new userscript by importing `backup_script.user.js`
4. In Tampermonkey settings, enable Advanced config, go to Downloads and whitelist the `gzip` extension.

# Usage
When you access the chat, you will automatically download logs if it has been more than 24 hours since your last backup.
If your chat logs are cleared for whatever reason (corruption, auto-deletion, etc.) you'll be prompted to restore your logs from a file.
