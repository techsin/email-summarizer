const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = 'token.json';

// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
    if (err) return console.log('Error loading client secret file:', err);
    authorize(JSON.parse(content), listUnreadMessages);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getNewToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

/**
 * Lists the email addresses with the most unread emails.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listUnreadMessages(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
    try {
        const messages = await getAllMessages(gmail);
        if (!messages || messages.length === 0) {
            console.log('No unread messages found.');
            return;
        }

        const senders = {};
        for (const message of messages) {
            const messageDetails = await getMessageDetails(gmail, message.id);
            const fromHeader = messageDetails.payload.headers.find((header) => header.name === 'From');
            if (fromHeader) {
                const sender = fromHeader.value;
                if (!senders[sender]) {
                    senders[sender] = 0;
                }
                senders[sender] += 1;
            }
        }

        fs.writeFile('senders.json', JSON.stringify(senders, null, 2), (err) => {
            if (err) {
                console.log('Error writing to file:', err);
                return;
            }
            console.log('Senders data saved to senders.json');
        });
        displayTopSenders(senders);
    } catch (err) {
        console.error('Error listing unread messages:', err);
    }
}

/**
 * Retrieve all messages using pagination with throttling.
 * @param {google.gmail} gmail The Gmail API client.
 */
async function getAllMessages(gmail) {
    let allMessages = [];
    let nextPageToken = null;
    let retryCount = 0;

    do {
        try {
            const res = await gmail.users.messages.list({
                userId: 'me',
                q: 'is:unread',
                pageToken: nextPageToken,
            });
            allMessages = allMessages.concat(res.data.messages);
            nextPageToken = res.data.nextPageToken;
            await new Promise((resolve) => setTimeout(resolve, 500)); // Throttle requests
        } catch (err) {
            if (err.code === 429 && retryCount < 5) {
                const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
                console.log(`Rate limit exceeded. Retrying in ${(delay / 1000).toFixed(2)} seconds...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                retryCount++;
            } else {
                throw err;
            }
        }
    } while (nextPageToken);

    return allMessages;
}

/**
 * Retrieve message details.
 * @param {google.gmail} gmail The Gmail API client.
 * @param {string} messageId The ID of the message to retrieve.
 */
async function getMessageDetails(gmail, messageId) {
    try {
        const res = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
        });
        return res.data;
    } catch (err) {
        console.error('Error retrieving message:', err);
        throw err;
    }
}

function displayTopSenders(senders) {
    const sortedSenders = Object.entries(senders).sort((a, b) => b[1] - a[1]);
    console.log('Email addresses with the most unread emails:');
    sortedSenders.slice(0, 10).forEach(([sender, count]) => {
        console.log(`${sender}: ${count} unread emails`);
    });
}
