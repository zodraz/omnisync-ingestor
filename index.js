import * as dotenv from 'dotenv';
import PubSubApiClient from 'salesforce-pubsub-api-client';
import { EventGridPublisherClient, AzureKeyCredential } from "@azure/eventgrid";

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
        const subscribeCallback = async (subscription, callbackType, data) => {
            try {
                switch (callbackType) {
                    case 'event':
                        // Event received
                        console.log(
                            `${subscription.topicName} - Handling ${data.payload.ChangeEventHeader.entityName} change event ` +
                                `with ID ${data.replayId} ` +
                                `(${subscription.receivedEventCount}/${subscription.requestedEventCount} ` +
                                `events received so far)`
                        );
    
                        const dataStr = JSON.stringify(
                            data,
                            (key, value) =>
                                /* Convert BigInt values into strings and keep other types unchanged */
                                typeof value === 'bigint'
                                    ? value.toString()
                                    : value,
                            2
                        );
                        // Safely log event payload as a JSON string
                        console.log(dataStr);
    
                        const client = new EventGridPublisherClient(
                            process.env.AZURE_EVENT_GRID_ENDPOINT,
                            "CloudEvent",
                            new AzureKeyCredential(process.env.AZURE_EVENT_GRID_ACCESS_TOKEN),
                          );
                        
                        const changeEventType =
                            data.payload.ChangeEventHeader.changeType.toLowerCase().charAt(0).toUpperCase() +
                            data.payload.ChangeEventHeader.changeType.toLowerCase().slice(1);
    
                        console.log('Sending to EventGrid...');
    
                        // Send an event to the Event Grid Service, using the Cloud Event schema.
                        // A random ID will be generated for this event, since one is not provided.
                        await client.send([
                           {
                                type: data.payload.ChangeEventHeader.entityName + changeEventType,
                                subject: data.replayId.toString(),
                                source: process.env.AZURE_EVENT_GRID_TOPIC,
                                data: {
                                    message: dataStr
                                }
                            }
                        ]);
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
            } catch (error) {
                console.log(error);
            }     
        };

        // Subscribe to 3 account change event
        client.subscribe('/data/OmniSync_Channel__chn', subscribeCallback, 3);
    } catch (error) {
        console.error(error);
    }
}

run();