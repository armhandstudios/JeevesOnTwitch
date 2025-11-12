"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = __importDefault(require("ws"));
const text_commands_json_1 = __importDefault(require("./text_commands.json"));
const SECRETS = require("./secrets.json");
const BOT_USER_ID = SECRETS.BOT_USER_ID;
const OAUTH_TOKEN = SECRETS.OAUTH_TOKEN;
const CLIENT_ID = SECRETS.CLIENT_ID;
const CHAT_CHANNEL_USER_ID = SECRETS.CHAT_CHANNEL_USER_ID;
const EVENTSUB_WEBSOCKET_URL = 'wss://eventsub.wss.twitch.tv/ws';
var websocketSessionID;
var textCommands = text_commands_json_1.default;
var gambaQuestion;
var gambaState = "NONE";
var gambaOptions = [];
var activeGambaData;
const gambaStateNone = "NONE";
const gambaStateInitialized = "INITIALIZED";
const gambaStateRunning = "RUNNING";
///IRC
const nick = "ThisCouldBeAnything";
const ircSocket = new ws_1.default("wss://irc-ws.chat.twitch.tv:443");
const channel = "its_fenix_";
ircSocket.addEventListener('open', () => {
    ircSocket.send(`PASS oauth:${OAUTH_TOKEN}`);
    ircSocket.send(`NICK ${nick}`);
    ircSocket.send(`JOIN #${channel}`);
});
ircSocket.addEventListener('message', event => {
    console.log(event.data); //Check to see if the message was "HeyGuys"
    var chatMessageOrig = getChatMessageFromIrcMessage(event.data.toString());
    var chatMessage = chatMessageOrig.toLowerCase();
    //Do not respond to own messages
    //Handle Ping
    if (event.data.toString().includes("PING")) {
        ircSocket.send("PONG");
    }
    //Gamba
    if (chatMessage.includes("!gamba")) {
        //Start Gamba
        //Cannot run gamba if one is already running
        if (gambaState == gambaStateRunning) {
            sendChatMessage("Gamba already in progress");
            return;
        }
        const parts = chatMessageOrig.split("!gamba", 2);
        if (parts.length < 2) {
            sendChatMessage("Syntax: !+gamba [question]");
            return;
        }
        gambaQuestion = parts[1].trim();
        gambaState = gambaStateInitialized;
        gambaOptions = [];
        sendChatMessage(`/pin Gamba initialized: ${gambaQuestion}. !+add to add options.`);
    }
    if (chatMessage.includes("!add")) {
        //Only allow options to be added if gamba is in INITIALIZED state
        if (gambaState != gambaStateInitialized) {
            sendChatMessage("Cannot add gamba option. There may be a gamba already running, or potentially a question hasn't been submitted");
            return;
        }
        //Add option to gamba or poll
        const parts = chatMessageOrig.split("!add", 2);
        if (parts.length < 2) {
            sendChatMessage("Syntax: !+add [poll/gamba option]");
            return;
        }
        gambaOptions.push(parts[1]);
        sendChatMessage(`Current gamba options: ${gambaOptions.toString()}`);
    }
    if (chatMessage.includes("!start")) {
        //Start gamba or poll
        createPrediction(gambaQuestion, gambaOptions);
        //placeholder until can start gamba
        sendChatMessage(`${gambaQuestion}: ${gambaOptions.toString()}`);
        gambaState = "RUNNING";
    }
    if (chatMessage.includes("!payout")) {
        if (gambaState != "RUNNING") {
            sendChatMessage("Gamba must currently be running to payout an option");
            return;
        }
        const parts = chatMessageOrig.split("!payout", 2);
        if (parts.length < 2) {
            sendChatMessage("Syntax: !+payout [gamba option]");
            return;
        }
        let gambaOptionId = getGambaOptionIdByName(parts[1]);
        if (gambaOptionId == null) {
            sendChatMessage(`Could not find option ${parts[1]}`);
            return;
        }
        payoutPrediction(gambaOptionId);
        gambaState = gambaStateNone;
    }
    //Handle Text Commands
    for (const [commandName, commandOutput] of Object.entries(text_commands_json_1.default)) {
        if (chatMessage.includes(commandName.toLowerCase())) {
            sendChatMessage(commandOutput);
        }
    }
});
function sendChatMessage(chatMessage) {
    ircSocket.send(`PRIVMSG #${channel} :${chatMessage}`);
}
function getChatMessageFromIrcMessage(ircMessage) {
    //: its_fenix_!its_fenix_ @its_fenix_.tmi.twitch.tv PRIVMSG #its_fenix_ : testnessage
    const parts = ircMessage.split(' :', 2); // Split into max 3 parts
    if (parts.length < 2) {
        return '';
    }
    return parts[1].trim();
}
///PUBSUB
//Entry point
(() => __awaiter(void 0, void 0, void 0, function* () {
    // Verify that the authentication is valid
    yield getAuth();
    // Start WebSocket client and register handlers
    const websocketClient = startWebSocketClient();
}))();
// WebSocket will persist the application loop until program is exited forcefully
function getAuth() {
    return __awaiter(this, void 0, void 0, function* () {
        // https://dev.twitch.tv/docs/authentication/validate-tokens/#how-to-validate-a-token
        let response = yield fetch('https://id.twitch.tv/oauth2/validate', {
            method: 'GET',
            headers: {
                'Authorization': 'OAuth ' + OAUTH_TOKEN
            }
        });
        if (response.status != 200) {
            let data = yield response.json();
            console.error("Token is not valid. /oauth/validate returned status code " + response.status);
            console.error(data);
            process.exit(1);
        }
        console.log("Validated token");
    });
}
function startWebSocketClient() {
    let websocketClient = new ws_1.default(EVENTSUB_WEBSOCKET_URL);
    websocketClient.on('error', console.error);
    websocketClient.on('open', () => {
        console.log('WebSocket connection opened to ' + EVENTSUB_WEBSOCKET_URL);
    });
    websocketClient.on('message', (data) => {
        handleWebSocketMessage(JSON.parse(data.toString()));
    });
    return websocketClient;
}
function handleWebSocketMessage(data) {
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
function registerEventSubListeners() {
    return __awaiter(this, void 0, void 0, function* () {
        registerEventSubListener("stream.online");
        registerEventSubListener("channel.prediction.begin");
        registerEventSubListener("channel.prediction.end");
    });
}
function registerEventSubListener(eventType) {
    return __awaiter(this, void 0, void 0, function* () {
        // Register channel.chat.message
        let response = yield fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + OAUTH_TOKEN,
                'Client-Id': CLIENT_ID,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: eventType,
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
            let data = yield response.json();
            console.error(`Failed to subscribe to ${eventType}. API call returned status code ${response.status}; body = ${response.body}`);
            console.error(data);
            process.exit(1);
        }
        else {
            const data = yield response.json();
            console.log(`Subscribed to ${eventType} [${data.data[0].id}]`);
        }
    });
}
function createPrediction(question, options, time = 120) {
    return __awaiter(this, void 0, void 0, function* () {
        let formattedOptions = options.map(o => ({ title: o }));
        let jsonBody = JSON.stringify({
            'broadcaster_id': CHAT_CHANNEL_USER_ID,
            'title': question,
            'outcomes': formattedOptions,
            'prediction_window': time
        });
        console.log(jsonBody);
        let response = yield fetch("https://api.twitch.tv/helix/predictions", {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + OAUTH_TOKEN,
                'Client-Id': CLIENT_ID,
                'Content-Type': 'application/json'
            },
            body: jsonBody
        });
        let data = yield response.json();
        if (response.status != 200) {
            console.error(`Failed to start prediction. Status code ${response.status}; body = ${response.body}`);
            sendChatMessage("Couldn't start gamba. Make sure one isn't already running");
            return;
        }
        activeGambaData = data.data[0];
    });
}
function payoutPrediction(option) {
    return __awaiter(this, void 0, void 0, function* () {
        let response = yield fetch(`https://api.twitch.tv/helix/predictions`
            + `?broadcaster_id=${activeGambaData.broadcaster_id}`
            + `&id=${activeGambaData.id}`
            + `&status=RESOLVED`
            + `&winning_outcome_id=${option}`, {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + OAUTH_TOKEN,
                'Client-Id': CLIENT_ID
            }
        });
        let data = yield response.json();
    });
}
function getGambaOptionIdByName(option) {
    const outcome = activeGambaData.outcomes.find(outcome => outcome.title === option);
    if (!outcome) {
        return null;
    }
    return outcome.id;
}
//# sourceMappingURL=app.js.map