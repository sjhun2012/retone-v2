package com.retone.app;
public final class AndroidPolicyTests {
    public static void main(String[] args){
        if(!AppPolicy.trusted("https://retone-v2-mygr.onrender.com/")||!AppPolicy.trusted("https://retone-v2-mygr.onrender.com:443/api/bootstrap"))throw new AssertionError("Trusted origin rejected");
        for(String value:new String[]{"http://retone-v2-mygr.onrender.com/","https://retone-v2-mygr.onrender.com.evil.test/","https://user@retone-v2-mygr.onrender.com/","https://retone-v2-mygr.onrender.com:8443/","file:///etc/passwd","javascript:alert(1)","content://com.retone.app.files/camera/x.jpg",null})
            if(AppPolicy.trusted(value))throw new AssertionError("Untrusted origin accepted: "+value);
        for(String value:new String[]{"https://retone-v2-mygr.onrender.com/friend.html?code=abc123","retone://friend?code=abc123"})
            if(!"ABC123".equals(AppPolicy.friendCode(value)))throw new AssertionError("Invite rejected");
        for(String value:new String[]{"retone://friend?code=ABC123&code=DEF456","retone://friend/path?code=ABC123","retone://friend:443?code=ABC123","retone://user@friend?code=ABC123","retone://friend?code=ABC123#bad","https://evil.test/friend.html?code=ABC123","retone://friend?code=ABC123%0A","retone://friend?code=ABC123&url=evil"})
            if(AppPolicy.friendCode(value)!=null)throw new AssertionError("Unsafe invite accepted: "+value);
        System.out.println("Android origin and invite policy passed.");
    }
}
