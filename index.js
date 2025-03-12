import * as dotenv from 'dotenv';
import PubSubApiClient from 'salesforce-pubsub-api-client';
import { EventGridPublisherClient, AzureKeyCredential } from "@azure/eventgrid";
import { v4 as uuidv4 } from 'uuid';

async function run() {
    try {

        // Patch for BigInt serialization on JSON.stringify
        BigInt.prototype.toJSON = function () {
            const int = Number.parseInt(this.toString());
            return int ?? this.toString();
          };
          
        // Load config from .env file
        dotenv.config();

        // Build and connect Pub/Sub API client
        const client = new PubSubApiClient({
                authType: 'oauth-client-credentials',
                loginUrl: process.env.SALESFORCE_LOGIN_URL,
                clientId: process.env.SALESFORCE_CLIENT_ID,
                clientSecret: process.env.SALESFORCE_CLIENT_SECRET
            });

        console.log('Client about to connect...');
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

                        //Override bigint since fixing the prototype doesn´t work all the times
                        data.payload.ChangeEventHeader.commitNumber = 0;
    
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

                        await client.send([
                            {
                                id: uuidv4(),
                                type: data.payload.ChangeEventHeader.entityName + changeEventType,
                                subject: data.payload.ChangeEventHeader.entityName ,
                                source: process.env.AZURE_EVENT_GRID_SOURCE,
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