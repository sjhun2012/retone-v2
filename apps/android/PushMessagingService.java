package com.retone.app;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
/** FCM wakes this short-lived service. No background polling service is used. */
public final class PushMessagingService extends FirebaseMessagingService {
    @Override public void onMessageReceived(RemoteMessage message){
        Map<String,String> data=message.getData();PushClient.show(this,data.get("notice_id"),data.get("user_id"),data.get("title"),data.get("body"));
    }
    @Override public void onNewToken(String token){PushClient.refreshRegistration(this,token);}
}
