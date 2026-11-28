package com.retone.app;
import android.app.Application;
public final class RetoneApplication extends Application {
    @Override public void onCreate(){super.onCreate();PushClient.initialize(this);}
}
