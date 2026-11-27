package com.retone.app;
import java.net.URI;
import java.net.URLDecoder;

public final class AppPolicy {
    public static final String ORIGIN = "https://retone-v2-mygr.onrender.com";
    public static boolean trusted(String value) {
        try {
            URI uri = new URI(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && "retone-v2-mygr.onrender.com".equalsIgnoreCase(uri.getHost()) &&
                uri.getRawUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception error) { return false; }
    }
    public static String friendCode(String value) {
        if (value == null || value.length() > 512) return null;
        try {
            URI uri = new URI(value);
            boolean custom = "retone".equalsIgnoreCase(uri.getScheme()) && "friend".equalsIgnoreCase(uri.getHost()) &&
                uri.getRawUserInfo() == null && uri.getPort() == -1 && ("".equals(uri.getPath()) || "/".equals(uri.getPath()));
            if ((!custom && !(trusted(value) && "/friend.html".equals(uri.getPath()))) || uri.getFragment() != null || uri.getRawQuery() == null) return null;
            String code = null;
            for (String part : uri.getRawQuery().split("&")) {
                String[] pair = part.split("=",2);
                if (pair.length != 2 || !"code".equals(pair[0]) || code != null) return null;
                code = URLDecoder.decode(pair[1], "UTF-8");
            }
            return code != null && code.matches("[A-Za-z0-9]{6}") ? code.toUpperCase(java.util.Locale.ROOT) : null;
        } catch (Exception error) { return null; }
    }
}
