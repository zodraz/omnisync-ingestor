import * as dotenv from 'dotenv';
import PubSubApiClient from 'salesforce-pubsub-api-client';

async function run() {
    try {
        // Load config from .env file
        dotenv.config();

        // Build and connect Pub/Sub API client
        const client = new PubSubApiClient({
                authType: 'oauth-client-credentials',
                loginUrl: process.env.SALESFORCE_LOGIN_URL,
                clientId: process.env.SALESFORCE_CLIENT_ID,
                clientSecret: process.env.SALESFORCE_CLIENT_SECRET
            });

        console.log('Client connecting...');
        await client.connect();

        // Prepare event callback
        const subscribeCallback = (subscription, callbackType, data) => {
            switch (callbackType) {
                case 'event':
                    // Event received
                    console.log(
                        `${subscription.topicName} - Handling ${data.payload.ChangeEventHeader.entityName} change event ` +
                            `with ID ${data.replayId} ` +
                            `(${subscription.receivedEventCount}/${subscription.requestedEventCount} ` +
                            `events received so far)`
                    );
                    // Safely log event payload as a JSON string
                    console.log(
                        JSON.stringify(
                            data,
                            (key, value) =>
                                /* Convert BigInt values into strings and keep other types unchanged */
                                typeof value === 'bigint'
                                    ? value.toString()
                                    : value,
                            2
                        )
                    );
                    break;
                case 'lastEvent':
                    // Last event received
                    console.log(
                        `${subscription.topicName} - Reached last of ${subscription.requestedEventCount} requested event on channel. Closing connection.`
                    );
                    break;
                case 'end':
                    // Client closed the connection
                    console.log('Client shut down gracefully.');
                    break;
            }
        };

        // Subscribe to 3 account change event
        client.subscribe('/data/OmniSync_Channel__chn', subscribeCallback, 3);
    } catch (error) {
        console.error(error);
    }
}

run();