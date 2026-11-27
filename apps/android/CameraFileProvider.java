package com.retone.app;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Grants the selected camera temporary access to one app-owned capture file. */
public final class CameraFileProvider extends ContentProvider {
    static File file(Context context, Uri uri) throws FileNotFoundException {
        if (!"com.retone.app.files".equals(uri.getAuthority()) || uri.getPath() == null || !uri.getPath().matches("/camera/[0-9a-f-]{36}\\.jpg")) throw new FileNotFoundException("Invalid capture URI");
        File directory = new File(context.getCacheDir(), "camera");
        if (!directory.exists() && !directory.mkdirs()) throw new FileNotFoundException("Camera cache unavailable");
        return new File(directory, uri.getLastPathSegment());
    }
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { try { file(getContext(),uri); return "image/jpeg"; } catch (FileNotFoundException error) { return null; } }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        int flags;
        if ("r".equals(mode)) flags = ParcelFileDescriptor.MODE_READ_ONLY;
        else if ("w".equals(mode) || "rw".equals(mode)) flags = ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE;
        else throw new FileNotFoundException("Unsupported file mode");
        return ParcelFileDescriptor.open(file(getContext(),uri),flags);
    }
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort) {
        try {
            File capture=file(getContext(),uri);
            MatrixCursor cursor = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE});
            cursor.addRow(new Object[]{capture.getName(),capture.length()}); return cursor;
        } catch (FileNotFoundException error) { return null; }
    }
    @Override public Uri insert(Uri uri,ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri,ContentValues values,String selection,String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri,String selection,String[] args) { throw new UnsupportedOperationException(); }
}
