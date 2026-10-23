package blueprints.source;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public final class ProjectExporter {
    private ProjectExporter() {}

    /** zip с исходной структурой (включая отрезанную обёртку root), байты как загружены; includeSettings добавляет tests/. */
    public static byte[] zip(LoadedProject p, boolean includeSettings) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(bos)) {
            for (SourceFile f : p.files()) put(z, p.root() + f.path(), f.content());
            if (includeSettings) for (var e : p.testFiles().entrySet()) put(z, p.root() + e.getKey(), e.getValue());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return bos.toByteArray();
    }

    private static void put(ZipOutputStream z, String path, byte[] data) throws IOException {
        z.putNextEntry(new ZipEntry(path));
        z.write(data);
        z.closeEntry();
    }
}
