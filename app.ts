import WebSocket from 'ws'
import TextCommands from './text_commands.json';

const SECRETS: any = require("./secrets.json")

const BOT_USER_ID: string = SECRETS.BOT_USER_ID;
const OAUTH_TOKEN: string = SECRETS.OAUTH_TOKEN;
const CLIENT_ID: string = SECRETS.CLIENT_ID;

const CHAT_CHANNEL_USER_ID: string = SECRETS.CHAT_CHANNEL_USER_ID

const EVENTSUB_WEBSOCKET_URL = 'wss://eventsub.wss.twitch.tv/ws'



var websocketSessionID: string;
var textCommands: Record<string, string> = TextCommands;

///IRC
const nick = "ThisCouldBeAnything"
const ircSocket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
const channel = "its_fenix_"

ircSocket.addEventListener('open', () => {
    ircSocket.send(`PASS oauth:${OAUTH_TOKEN}`);
    ircSocket.send(`NICK ${nick}`);
    ircSocket.send(`JOIN #${channel}`);
});

ircSocket.addEventListener('message', event => {
    console.log(event.data);//Check to see if the message was "HeyGuys"
    var chatMessage = getChatMessageFromIrcMessage(event.data.toString())

    //Handle Ping
    if (event.data.toString().includes("PING")) {
        ircSocket.send("PONG");
    }

    for (const [commandName, commandOutput] of Object.entries(TextCommands)) {
        if (chatMessage.includes(commandName)) {
            sendChatMessage(commandOutput);
        }
    }
});

function sendChatMessage(chatMessage: string) {
    ircSocket.send(`PRIVMSG #${channel} :${chatMessage}`);
}

function getChatMessageFromIrcMessage(ircMessage: string): string {
    //: its_fenix_!its_fenix_ @its_fenix_.tmi.twitch.tv PRIVMSG #its_fenix_ : testnessage
    const parts = ircMessage.split(' :', 2); // Split into max 3 parts
    return parts[1].trim().trim();
}

///PUBSUB
//Entry point
(async () => {
    // Verify that the authentication is valid
    await getAuth();

    // Start WebSocket client and register handlers
    const websocketClient = startWebSocketClient();
})();

// WebSocket will persist the application loop until program is exited forcefully

async function getAuth() {
    // https://dev.twitch.tv/docs/authentication/validate-tokens/#how-to-validate-a-token
    let response: Response = await fetch('https://id.twitch.tv/oauth2/validate', {
        method: 'GET',
        headers: {
            'Authorization': 'OAuth ' + OAUTH_TOKEN
        }
    });

    if (response.status != 200) {
        let data = await response.json();
        console.error("Token is not valid. /oauth/validate returned status code " + response.status);
        console.error(data);
        process.exit(1);
    }

    console.log("Validated token");
}

function startWebSocketClient() {
    let websocketClient: WebSocket = new WebSocket(EVENTSUB_WEBSOCKET_URL);

    websocketClient.on('error', console.error);

    websocketClient.on('open', () => {
        console.log('WebSocket connection opened to ' + EVENTSUB_WEBSOCKET_URL);
    });

    websocketClient.on('message', (data) => {
        handleWebSocketMessage(JSON.parse(data.toString()));
    });

    return websocketClient;
}

function handleWebSocketMessage(data: any) {
    switch (data.metadata.message_type) {
        case 'session_welcome': // First message you get from the WebSocket server when connection
            websocketSessionID = data.payload.session.id; // Register the Session ID it gives us

            // Listen to EventSub, which joins the chatroom from your bot's account
            registerEventSubListeners();
            break;

        case 'notification': // An EventSub notification has occurred, such as channel.chat.message
            switch (data.metadata.subscription_type) {
                case 'channel.chat.message':
                    //Print the message to the program's console
                    console.log(`MSG #${data.payload.event.broadcaster_user_login} <${data.payload.event.chatter_user_lobgin}> ${data.payload.event.message.text}`);

                    //Check to see if the message was "HeyGuys"
                    if (data.payload.event.message.text.trim() == "HeyGuys") {
                        // If so, send back "VoHiYo" to the chatroom
                        //sendChatMessage("VoHiYo");
                    }

                    break;
            }

            break;
    }
}



async function registerEventSubListeners() {
    // Register channel.chat.message
    let response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + OAUTH_TOKEN,
            'Client-Id': CLIENT_ID,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            type: 'stream.online',
            version: '1',
            condition: {
                broadcaster_user_id: CHAT_CHANNEL_USER_ID,
                user_id: BOT_USER_ID
            },
            transport: {
                method: 'websocket',
                session_id: websocketSessionID
            }
        })
    });

    if (response.status != 202) {
        let data = await response.json();
        console.error("Failed to subscribe to channel.chat.message. API call returned status code " + response.status + "; body = " + response.body);
        console.error(data);
        process.exit(1);
    } else {
        const data: any = await response.json();
        console.log(`Subscribed to channel.chat.message [${data.data[0].id}]`)
    }

}


