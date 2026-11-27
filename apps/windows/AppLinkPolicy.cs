using System;
using System.Text.RegularExpressions;

internal static class AppLinkPolicy {
    internal static string FriendCode(string value) {
        Uri uri;
        if (String.IsNullOrEmpty(value) || value.Length > 256 || !Uri.TryCreate(value, UriKind.Absolute, out uri) ||
            uri.Scheme != "retone" || uri.Host != "friend" || uri.UserInfo != "" || !uri.IsDefaultPort ||
            (uri.AbsolutePath != "" && uri.AbsolutePath != "/") || uri.Fragment != "") return null;
        string code = null;
        foreach (string part in uri.Query.TrimStart('?').Split('&')) {
            string[] pair = part.Split(new char[] {'='}, 2);
            if (pair.Length != 2 || pair[0] != "code" || code != null) return null;
            code = Uri.UnescapeDataString(pair[1]);
        }
        return code != null && Regex.IsMatch(code, @"\A[A-Za-z0-9]{6}\z") ? code.ToUpperInvariant() : null;
    }
}
