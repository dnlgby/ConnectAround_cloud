const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);


const COS = Math.cos;
const PI_DIV_180 = 0.017453292519943295; // Math.PI / 180
const EARTH_RADIUS = 6371;
const TO_METERS = 1000;

const CHAT_ROOMS_COLLECTION_KEY = "ChatRooms";
const CHAT_ROOMS_COLLECTION_PATH = "ChatRooms/{chatRoomId}";
const MESSAGES_COLLECTION_KEY = "Messages";
const SUBSCRIPTIONS_COLLECTION_KEY = "Subscriptions";
const SUBSCRIPTIONS_COLLECTION_PATH = "Subscriptions/{subscriptionId}";
const USERS_COLLECTION_PATH = "Users/{userId}"
const USER_LOCATIONS_PATH = "_UsersLocations/{userId}"
const USERS_LOCATION_CHAT_ROOMS_COLLECTION_KEY = "_UsersLocationChatRooms";
const CHAT_ROOMS_ROOM_INDEXES_COLLECTION_KEY = "_Indexes";
const CHAT_ROOMS_ROOM_INDEXES_COLLECTION_PATH = "_Indexes/{chatRoomId}";
const NOTIFICATIONS_COLLECTION_KEY = "_Notifications";
const NOTIFICATIONS_TOGGLE_COLLECTION_KEY = "_NotificationsToggle";
const TOKENS_COLLECTION_KEY = "_Tokens";
const TOKENS_COLLECTION_PATH = "_Tokens/{userId}";

const STORAGE_PROJECT_BUCKET = "gs://connectaround-82fe5.appspot.com/";
const STORAGE_CHAT_ROOMS_FILE_MESSAGES = "chatRoomsFileMessages/";
const STORAGE_CHAT_ROOMS_LOCATION_IMAGES = "chatRoomsLocationImages/";
const STORAGE_CHAT_ROOMS_LOGOS = "chatRoomsLogos/";

const FIRST_SUBSCRIBER = 1;
const TEST_ROOM_ID = "85f7d480-eb69-4cfa-9e53-d807a53076ac";


exports.onUserCreated = functions.firestore
.document(USERS_COLLECTION_PATH)
.onCreate((snapshot, context) => {
    const userId = snapshot.id;
    return admin.firestore().collection(NOTIFICATIONS_TOGGLE_COLLECTION_KEY).doc(userId).set({ "allow": true })
});


exports.provideChatRoomsAroundUser = functions.firestore
.document(USER_LOCATIONS_PATH)
.onUpdate((change, context) => {

    const userId = context.params.userId;
    const locationData = change.after.data();

    const userCurrentLat = locationData.lat;
    const userCurrentLng = locationData.lng;
    const chatRoomsAround: any[] | never[] = [];
    const updatingPromisses: any[] | never[] = [];

    console.log('User ID:', userId);
    console.log('User current lat:', userCurrentLat);
    console.log('User current lng:', userCurrentLng);

    return admin.firestore().collection(CHAT_ROOMS_COLLECTION_KEY).get().then(result =>
        {
            result.forEach(element =>
                {
                    const chatRoomId = element.id;
                    const chatRoomData = element.data();
                    const chatRoomLat = chatRoomData.locationLat;
                    const chatRoomLng = chatRoomData.locationLng;
                    const chatRoomRadius = chatRoomData.chatRoomRadius;

                    const a = 0.5 - COS((chatRoomLat-userCurrentLat) * PI_DIV_180) / 2 + COS(userCurrentLat * PI_DIV_180) *
                    COS((chatRoomLat) * PI_DIV_180) * (1 - COS(((chatRoomLng - userCurrentLng) * PI_DIV_180))) / 2;
                    const distance = (2 * EARTH_RADIUS * Math.asin(Math.sqrt(a)))*TO_METERS;

                    console.log('Distance:', distance);
                    console.log('chatRoomLat:', chatRoomLat);
                    console.log('chatRoomLng:', chatRoomLng);

                    if (distance <= chatRoomRadius) chatRoomsAround.push(chatRoomId);
                    updatingPromisses.push(getSubscriptionAtLocationChangePromise(userId, chatRoomId, distance <= chatRoomRadius))

                });

                //Adding the test room.
                chatRoomsAround.push(TEST_ROOM_ID);

                console.log('Chat Rooms around user:', chatRoomsAround);

                updatingPromisses.push(admin.firestore().collection(USERS_LOCATION_CHAT_ROOMS_COLLECTION_KEY)
                        .doc(userId).set({CHAT_ROOMS_AROUND: chatRoomsAround}));

                return Promise.all(updatingPromisses);

        });

});


exports.calculateChatRoomsStatusOnSubscriptionUpdate = functions.firestore
.document(SUBSCRIPTIONS_COLLECTION_PATH)
.onUpdate((change, context) => {

    const afterChangeData = change.after.data();
    const subscriptionId = change.after.id;
    const chatRoomId = afterChangeData.chatRoomId;
    const loggedIn = afterChangeData.loggedIn;
    const promissesToMake: any[] | never[] = [];

    // If user is connected to the room again, make the notification available again to the user.
    if (loggedIn == true)
        promissesToMake.push(admin.firestore().collection(NOTIFICATIONS_COLLECTION_KEY).doc(subscriptionId).set({ "notified": false }))

    // Recalculate the current logged in users
    promissesToMake.push(admin.firestore().collection(SUBSCRIPTIONS_COLLECTION_KEY).where("chatRoomId", "==", chatRoomId).get().then(querySnapshot => {
        let currentLoggedInUsers = 0;
        if (!querySnapshot.empty) {
            querySnapshot.docs.map((subsciptionDocItem) => {
                const subscriptionData = subsciptionDocItem.data();
                if (subscriptionData.loggedIn) currentLoggedInUsers = currentLoggedInUsers + 1
            })
        }
        return admin.firestore().collection(CHAT_ROOMS_COLLECTION_KEY).doc(chatRoomId).update(
            { "loggedInUsers": currentLoggedInUsers })

    }));
    return Promise.all(promissesToMake);
});



exports.calculateChatRoomsStatusOnSubscriptionCreate = functions.firestore
    .document(SUBSCRIPTIONS_COLLECTION_PATH)
    .onCreate((snapshot, context) => {
        const subscriptionId = snapshot.id;
        const createData = snapshot.data();
        const chatRoomId = createData.chatRoomId;

        return admin.firestore().collection(CHAT_ROOMS_COLLECTION_KEY).doc(chatRoomId).get().then(chatRoomResult => {
            const chatRoomData = chatRoomResult.data();
            const chatRoomSubscribers = chatRoomData.subscribers;
            const currentChatRoomSubscribers = typeof chatRoomSubscribers !== 'undefined' ? chatRoomSubscribers + 1 : FIRST_SUBSCRIBER;
            return admin.firestore().collection(CHAT_ROOMS_COLLECTION_KEY).doc(chatRoomId).update(
                { "subscribers": currentChatRoomSubscribers }).then(updateResult => {
                    return admin.firestore().collection(NOTIFICATIONS_COLLECTION_KEY).doc(subscriptionId).set({ "notified": false })
                });
        });
    });


exports.calculateChatRoomsStatusOnSubscriptionCreate = functions.firestore
.document(SUBSCRIPTIONS_COLLECTION_PATH)
.onCreate((snapshot, context) => {
    const subscriptionId = snapshot.id;
    const createData = snapshot.data();
    const chatRoomId = createData.chatRoomId;

    return admin.firestore().collection(CHAT_ROOMS_COLLECTION_KEY).doc(chatRoomId).get().then(chatRoomResult =>
        {
            const chatRoomData = chatRoomResult.data();
            const chatRoomSubscribers = chatRoomData.subscribers;
            const currentChatRoomSubscribers = typeof chatRoomSubscribers !== 'undefined' ? chatRoomSubscribers+1 : FIRST_SUBSCRIBER;
            return admin.firestore().collection(CHAT_ROOMS_COLLECTION_KEY).doc(chatRoomId).update(
                { "subscribers": currentChatRoomSubscribers }).then(updateResult => {
                    return admin.firestore().collection(NOTIFICATIONS_COLLECTION_KEY).doc(subscriptionId).set({ "notified": false })
                });
        });
});


exports.calculateChatRoomsStatusOnSubscriptionDelete = functions.firestore
.document(SUBSCRIPTIONS_COLLECTION_PATH)
.onDelete((snapshot, context) => {
    const subscriptionId = snapshot.id;
    const deleteData = snapshot.data();
    const chatRoomId = deleteData.chatRoomId;
    const promissesToMake: any[] | never[] = [];

    //Remove the notification channel as well.
    promissesToMake.push(admin.firestore().collection(NOTIFICATIONS_COLLECTION_KEY).doc(subscriptionId).delete())

    return admin.firestore().collection(CHAT_ROOMS_COLLECTION_KEY).doc(chatRoomId).get().then(chatRoomResult =>
    {
        const chatRoomData = chatRoomResult.data();
        if (typeof chatRoomData !== 'undefined')
        {
            const chatRoomSubscribers = chatRoomData.subscribers;
            promissesToMake.push(admin.firestore().collection(CHAT_ROOMS_COLLECTION_KEY).doc(chatRoomId).update(
                { "subscribers": chatRoomSubscribers - 1}))
        }
        return Promise.all(promissesToMake);
    });
});

//Need to delete all array items with chatroomid
exports.deleteChatRoom = functions.firestore
    .document(CHAT_ROOMS_COLLECTION_PATH)
    .onDelete((snapshot, context) => {
        const chatRoomId = snapshot.id;

        console.log('Deleting ChatRoom id:', chatRoomId);

        //Storage
        const bucket = admin.storage().bucket(STORAGE_PROJECT_BUCKET);
        const messagesFilesPath = STORAGE_CHAT_ROOMS_FILE_MESSAGES.concat(chatRoomId).concat("/");
        const locationImagePath = STORAGE_CHAT_ROOMS_LOCATION_IMAGES.concat(chatRoomId)
        const logoImagePath = STORAGE_CHAT_ROOMS_LOGOS.concat(chatRoomId)

        const deleteChatMessagesFiles = bucket.deleteFiles({ prefix: messagesFilesPath });
        const deleteLocationImage = bucket.file(locationImagePath).delete();
        const deleteLogoImage = bucket.file(logoImagePath).delete();


        //Database
        const messagesPath = CHAT_ROOMS_COLLECTION_KEY.concat('/').concat(chatRoomId).concat('/').concat(MESSAGES_COLLECTION_KEY)
        const deleteMessagesBatch = admin.firestore().batch();

        const deleteMessages = admin.firestore().collection(messagesPath).listDocuments().then(element => {
            element.map((docItem) => { deleteMessagesBatch.delete(docItem) })
            deleteMessagesBatch.commit()
        })

        const deleteIndexes = admin.firestore().collection(CHAT_ROOMS_ROOM_INDEXES_COLLECTION_KEY).doc(chatRoomId).delete();
        const deleteSubscriptions = admin.firestore().collection(SUBSCRIPTIONS_COLLECTION_KEY).where("chatRoomId", "==", chatRoomId).get()
            .then(querySnapshot => {
                const subscriptionToDelete: any[] | never[] = [];
                if (!querySnapshot.empty) {
                    querySnapshot.docs.map((subscriptionDocItem) => {
                        const subscriptionId = subscriptionDocItem.id;
                        subscriptionToDelete.push(admin.firestore().collection(SUBSCRIPTIONS_COLLECTION_KEY).doc(subscriptionId).delete());
                    })
                }
                return Promise.all(subscriptionToDelete);
            });

        const aroundChatRoomsUpdating = admin.firestore().collection(USERS_LOCATION_CHAT_ROOMS_COLLECTION_KEY).get().then(result => {
            const aroundChatRoomsUpdates: any[] | never[] = [];
            result.forEach(element => {
                const userId = element.id;
                const aroundChatRoomsData = element.data();
                const aroundChatRooms = aroundChatRoomsData.CHAT_ROOMS_AROUND;
                const index = aroundChatRooms.indexOf(chatRoomId, 0);
                if (index > -1)
                {
                    aroundChatRooms.splice(index, 1);
                    aroundChatRoomsUpdates.push(admin.firestore().collection(USERS_LOCATION_CHAT_ROOMS_COLLECTION_KEY)
                        .doc(userId).set({ CHAT_ROOMS_AROUND: aroundChatRooms }));
                }
            });
            return Promise.all(aroundChatRoomsUpdates);
        });

        return Promise.all([deleteMessages, deleteIndexes, deleteSubscriptions, aroundChatRoomsUpdating, deleteChatMessagesFiles, deleteLocationImage, deleteLogoImage]);
    });


exports.onTokenChanged = functions.firestore
    .document(TOKENS_COLLECTION_PATH)
    .onUpdate((change, context) => {
        const userId = change.after.id;
        const newToken = change.after.data().token;
        return deleteExistingTokens(userId, newToken);
    });


exports.onTokenCreated = functions.firestore
    .document(TOKENS_COLLECTION_PATH)
    .onCreate((snapshot, context) => {
        const userId = snapshot.id;
        const newToken = snapshot.data().token;
        return deleteExistingTokens(userId, newToken);
    });


exports.notifyUsers = functions.firestore
.document(CHAT_ROOMS_ROOM_INDEXES_COLLECTION_PATH)
.onUpdate((change, context) => {

    const chatRoomId = change.after.id
    const notificationVerifyPromises: any[] | never[] = [];
    const notificationToggleVerifyPromises: any[] | never[] = [];
    const tokensToGet: any[] | never[] = [];
    const notificationsToUpdate: any[] | never[] = [];
    const notificationsToSend: any[] | never[] = [];
    const subscriptionToUser = new Map();
    const notificationAllow = new Map();


    return admin.firestore().collection(SUBSCRIPTIONS_COLLECTION_KEY)
        .where("loggedIn", "==", false)
        .where("chatRoomId", "==", chatRoomId).get()
        .then(querySnapshot => {
            if (!querySnapshot.empty) {
                querySnapshot.docs.map((subscriptionDocItem) => {
                    const userId = subscriptionDocItem.data().userId;
                    const subscriptionId = subscriptionDocItem.id;
                    subscriptionToUser.set(subscriptionId, userId);
                    notificationVerifyPromises.push(admin.firestore().collection(NOTIFICATIONS_COLLECTION_KEY).doc(subscriptionId).get())
                    notificationToggleVerifyPromises.push(admin.firestore().collection(NOTIFICATIONS_TOGGLE_COLLECTION_KEY).doc(userId).get())
                })
            }

            return Promise.all(notificationToggleVerifyPromises).then(notificationToggleVerifyResults => {
                notificationToggleVerifyResults.map((notificationToggleItem) => {
                    const userId = notificationToggleItem.id;
                    const allow = notificationToggleItem.data().allow;
                    notificationAllow.set(userId,allow);
                });

                return Promise.all(notificationVerifyPromises).then(notificationToVerifyResults => {
                    notificationToVerifyResults.map((notificationItem) => {
                        const subscriptionId = notificationItem.id;
                        const notified = notificationItem.data().notified;
                        const userId = subscriptionToUser.get(subscriptionId);
                        const allow = notificationAllow.get(userId);

                        if (!notified && allow)
                        {
                            tokensToGet.push(admin.firestore().collection(TOKENS_COLLECTION_KEY).doc(userId).get())
                            notificationsToUpdate.push(admin.firestore().collection(NOTIFICATIONS_COLLECTION_KEY).doc(subscriptionId).update({ "notified": true }))
                        }

                    });

                    return Promise.all(tokensToGet).then(tokensToGetResults => {
                        tokensToGetResults.map((tokenDocItem) => {
                            const tokenData = tokenDocItem.data();

                            // User is 'In the air' no token in server (someone else logged in from his device and
                            // he didn't logged in again since then).
                            if (typeof tokenData != 'undefined')
                            {
                                const tokenId = tokenData.token;
                                notificationsToSend.push(sendNotification(tokenId, chatRoomId));
                            }
                        })
                        return Promise.all(notificationsToSend).then(sentNotificationResults => {
                            return Promise.all(notificationsToUpdate);
                        });
                    });
                });
            });
        });
});


function sendNotification(tokenId, chatRoomId) {
    return admin.firestore().collection(CHAT_ROOMS_COLLECTION_KEY).doc(chatRoomId).get()
        .then(chatRoomResult => {
            const chatRoomData = chatRoomResult.data();
            const chatRoomDataJson = JSON.stringify(chatRoomData);
                const notificationContent = {
                    data: {
                        title: "New Messages!",
                        chat_room_json: chatRoomDataJson,
                        chat_room_id: chatRoomId
                    }
                }
                return admin.messaging().sendToDevice(tokenId, notificationContent)
            });
}


function getSubscriptionAtLocationChangePromise(userId, chatRoomId, atLocation) {
    return admin.firestore().collection(SUBSCRIPTIONS_COLLECTION_KEY)
        .where("userId", "==", userId)
        .where("chatRoomId", "==", chatRoomId)
        .limit(1).get()
        .then(querySnapshot => {
            if (!querySnapshot.empty) {
                const subscriptionId = querySnapshot.docs[0].id;
                if (chatRoomId === TEST_ROOM_ID)
                    return admin.firestore().collection(SUBSCRIPTIONS_COLLECTION_KEY).doc(subscriptionId).update({ "atLocation": true })
                else
                    return admin.firestore().collection(SUBSCRIPTIONS_COLLECTION_KEY).doc(subscriptionId).update({ "atLocation": atLocation })
            }
        });
}


function deleteExistingTokens(userId, newToken) {
    const deleteExistingTokensBatch = admin.firestore().batch();
    return admin.firestore().collection(TOKENS_COLLECTION_KEY).where("token", "==", newToken).get()
        .then(querySnapshot => {
            if (!querySnapshot.empty) {
                querySnapshot.docs.map((tokenDocItem) => {
                    const curUserId = tokenDocItem.id;
                    if (curUserId != userId)
                        deleteExistingTokensBatch.delete(tokenDocItem.ref)
                })
                deleteExistingTokensBatch.commit();
            }
        });
}





///////////////////////////////////////////////  EXAMPLE FUNCTIONS  /////////////////////////////////////////////////////////




//NOTIFICATIONS

//Listen on _Indexes. if changing, iterate on subscriptions for that chatroom, if loggedIn == false - notify.
// const functions = require('firebase-functions');
// const admin = require('firebase-admin');
// admin.initializeApp(functions.config().firebase);

// exports.sendNotification = functions.firestore.document("notifications/{userEmail}/userNotifications/{notificationId}").onWrite(event => {
// 	const userEmail = event.params.userEmail;
// 	const notificationId = event.params.notificationId;

// 	return admin.firestore().collection("notifications").doc(userEmail).collection("userNotifications").doc(notificationId).get().then(queryResult => {
// 		const senderUserEmail = queryResult.data().senderUserEmail;
// 		const notificationMessage = queryResult.data().notificationMessage;

// 		const fromUser = admin.firestore().collection("users").doc(senderUserEmail).get();
// 		const toUser = admin.firestore().collection("users").doc(userEmail).get();

// 		return Promise.all([fromUser, toUser]).then(result => {
// 			const fromUserName = result[0].data().userName;
// 			const toUserName = result[1].data().userName;
// 			const tokenId = result[1].data().tokenId;

// 			const notificationContent = {
// 				notification: {
// 					title: fromUserName + " is shopping",
// 					body: notificationMessage,
// 					icon: "default"
// 				}
// 			};

// 			return admin.messaging().sendToDevice(tokenId, notificationContent).then(result => {
// 				console.log("Notification sent!");
// 				//admin.firestore().collection("notifications").doc(userEmail).collection("userNotifications").doc(notificationId).delete();
// 			});
// 		});
// 	});
// });




//Listen on _Indexes. if changing, iterate on subscriptions for that chatroom, if loggedIn == false - notify.


// exports.sendNotification = functions.firestore.document("notifications/{userEmail}/userNotifications/{notificationId}").onWrite(event => {
// 	const userEmail = event.params.userEmail;
// 	const notificationId = event.params.notificationId;

// 	return admin.firestore().collection("notifications").doc(userEmail).collection("userNotifications").doc(notificationId).get().then(queryResult => {
// 		const senderUserEmail = queryResult.data().senderUserEmail;
// 		const notificationMessage = queryResult.data().notificationMessage;

// 		const fromUser = admin.firestore().collection("users").doc(senderUserEmail).get();
// 		const toUser = admin.firestore().collection("users").doc(userEmail).get();

// 		return Promise.all([fromUser, toUser]).then(result => {
// 			const fromUserName = result[0].data().userName;
// 			const toUserName = result[1].data().userName;
// 			const tokenId = result[1].data().tokenId;

// 			const notificationContent = {
// 				notification: {
// 					title: fromUserName + " is shopping",
// 					body: notificationMessage,
// 					icon: "default"
// 				}
// 			};

// 			return admin.messaging().sendToDevice(tokenId, notificationContent).then(result => {
// 				console.log("Notification sent!");
// 				//admin.firestore().collection("notifications").doc(userEmail).collection("userNotifications").doc(notificationId).delete();
// 			});
// 		});
// 	});
// });




// exports.notifyUsers = functions.firestore
// .document(CHAT_ROOMS_ROOM_INDEXES_COLLECTION_PATH)
// .onUpdate((change, context) => {

//     const testUserId = "6PAhWuHjLGc9v7cgFvGbANslLp52";
//     const coll = "_Tokens";

//     return admin.firestore().collection(coll).doc(testUserId).get()
//     .then(docSnap => {
//         if (!docSnap.empty){

//             const tokenData = docSnap.data();
//             const tokenId = tokenData.token;
//             console.log("TOKEN:", tokenId);

//             const notificationContent = {
// 				data: {
// 					title: "New Messages!",
// 					room_title: "BLABLA",
// 				}
// 			};

// 			return admin.messaging().sendToDevice(tokenId, notificationContent).then(result => {
// 				console.log("Notification sent!");
// 			})

//         }
//     });
// });




// exports.notifyUsers = functions.firestore
// .document(CHAT_ROOMS_ROOM_INDEXES_COLLECTION_PATH)
// .onUpdate((change, context) => {
//     const chatRoomId = change.after.id
//     const tokensToGet: any[] | never[] = [];
//     const notificationsToSend: any[] | never[] = [];

//     const notificationContent = {
//         data: {
//             title: "New Messages!",
//             room_title: chatRoomId,
//         }
//     }

//     return admin.firestore().collection(SUBSCRIPTIONS_COLLECTION_KEY)
//         .where("loggedIn", "==", false)
//         .where("chatRoomId", "==", chatRoomId).get()
//         .then(querySnapshot => {
//             if (!querySnapshot.empty) {
//                 querySnapshot.docs.map((subscriptionDocItem) => {
//                     const userId = subscriptionDocItem.data().userId;
//                     tokensToGet.push(admin.firestore().collection(TOKENS_COLLECTION_KEY).doc(userId).get());
//                 })
//             }
//             return Promise.all(tokensToGet).then(results => {
//                 results.map((tokenDocItem) => {
//                     const tokenId = tokenDocItem.data().token;
//                     notificationsToSend.push(admin.messaging().sendToDevice(tokenId, notificationContent));
//                 })
//                 return Promise.all(notificationsToSend);
//             });
//         });
// });


// exports.notifyUsers2 = functions.firestore
// .document(CHAT_ROOMS_ROOM_INDEXES_COLLECTION_PATH)
// .onUpdate((change, context) => {

//     const chatRoomId = change.after.id
//     const tokensToGet: any[] | never[] = [];
//     const subscriptionsToUpdate: any[] | never[] = [];
//     const notificationsToSend: any[] | never[] = [];
//     console.log('notifyUsers');

//     return admin.firestore().collection(SUBSCRIPTIONS_COLLECTION_KEY)
//         .where("loggedIn", "==", false)
//         .where("chatRoomId", "==", chatRoomId)
//         .where("notified", "==", false).get()
//         .then(querySnapshot => {
//             if (!querySnapshot.empty) {
//                 querySnapshot.docs.map((subscriptionDocItem) => {
//                     const subscriptionId = subscriptionDocItem.id;
//                     const userId = subscriptionDocItem.data().userId;
//                     tokensToGet.push(admin.firestore().collection(TOKENS_COLLECTION_KEY).doc(userId).get())
//                     subscriptionsToUpdate.push(admin.firestore().collection(SUBSCRIPTIONS_COLLECTION_KEY).doc(subscriptionId).update({ "notified": true }))
//                 })
//             }
//             return Promise.all(tokensToGet).then(tokensToGetResults => {
//                 tokensToGetResults.map((tokenDocItem) => {
//                     const tokenId = tokenDocItem.data().token;
//                     notificationsToSend.push(sendNotification(tokenId, chatRoomId));
//                 })
//                 return Promise.all(notificationsToSend).then(sentNotificationResults => {
//                     return Promise.all(subscriptionsToUpdate);
//                 });
//             });
//         });
// });




// exports.notifyUsers = functions.firestore
//     .document(CHAT_ROOMS_ROOM_INDEXES_COLLECTION_PATH)
//     .onUpdate((change, context) => {

//         const chatRoomId = change.after.id
//         const notificationVerifyPromises: any[] | never[] = [];
//         const tokensToGet: any[] | never[] = [];
//         const notificationsToUpdate: any[] | never[] = [];
//         const notificationsToSend: any[] | never[] = [];
//         const subscriptionToUser = new Map();

//         return admin.firestore().collection(SUBSCRIPTIONS_COLLECTION_KEY)
//             .where("loggedIn", "==", false)
//             .where("chatRoomId", "==", chatRoomId).get()
//             .then(querySnapshot => {
//                 if (!querySnapshot.empty) {
//                     querySnapshot.docs.map((subscriptionDocItem) => {
//                         const userId = subscriptionDocItem.data().userId;
//                         const subscriptionId = subscriptionDocItem.id;
//                         subscriptionToUser.set(subscriptionId, userId);
//                         notificationVerifyPromises.push(admin.firestore().collection(NOTIFICATIONS_COLLECTION_KEY).doc(subscriptionId).get())
//                     })
//                 }

//                 return Promise.all(notificationVerifyPromises).then(notificationToVerifyResults => {
//                     notificationToVerifyResults.map((notificationItem) => {
//                         const subscriptionId = notificationItem.id;
//                         const userId = subscriptionToUser.get(subscriptionId);
//                         const notified = notificationItem.data().notified;
//                         if (!notified) {
//                             tokensToGet.push(admin.firestore().collection(TOKENS_COLLECTION_KEY).doc(userId).get())
//                             notificationsToUpdate.push(admin.firestore().collection(NOTIFICATIONS_COLLECTION_KEY).doc(subscriptionId).update({ "notified": true }))
//                         }

//                     });

//                     return Promise.all(tokensToGet).then(tokensToGetResults => {
//                         tokensToGetResults.map((tokenDocItem) => {
//                             const tokenData = tokenDocItem.data();

//                             // User is 'In the air' no token in server (someone else logged in from his device and
//                             // he didn't logged in again since then).
//                             if (typeof tokenData != 'undefined') {
//                                 const tokenId = tokenData.token;
//                                 notificationsToSend.push(sendNotification(tokenId, chatRoomId));
//                             }
//                         })
//                         return Promise.all(notificationsToSend).then(sentNotificationResults => {
//                             return Promise.all(notificationsToUpdate);
//                         });
//                     });
//                 });
//             });
//     });
