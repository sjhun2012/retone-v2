using System;
internal static class WindowsLinkPolicyTests {
    static int Main() {
        if (AppLinkPolicy.FriendCode("retone://friend?code=abc123") != "ABC123") throw new Exception("Valid invite failed");
        foreach (string value in new [] {
            "https://evil.test/?code=ABC123", "retone://friend.evil?code=ABC123", "retone://friend:443?code=ABC123",
            "retone://friend?code=ABC123&code=DEF456", "retone://friend?code=ABC123&url=https://evil.test/",
            "retone://user@friend?code=ABC123", "retone://friend/path?code=ABC123", "retone://friend?code=ABC123#bad",
            "retone://friend?code=ABC12", "retone://friend?code=ABC123%22%20--evil", "retone://friend?code=ABC123%0A"
        }) if (AppLinkPolicy.FriendCode(value) != null) throw new Exception("Unsafe invite accepted: " + value);
        Console.WriteLine("Windows invite protocol policy passed."); return 0;
    }
}
