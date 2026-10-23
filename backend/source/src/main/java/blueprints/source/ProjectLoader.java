package blueprints.source;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.TypeDeclaration;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Загрузка .java/.zip/.jar (ТЗ §11): защита распаковки, обёртка, пакеты, дубликаты FQN, tests/. */
public final class ProjectLoader {
    public static final long MAX_BYTES = 20L * 1024 * 1024;
    public static final int MAX_FILES = 2000;

    /** name — путь файла (webkitdirectory) или имя файла/архива. */
    public record Upload(String name, byte[] data) {}

    private ProjectLoader() {}

    public static LoadedProject load(List<Upload> uploads) {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        long[] total = {0};
        for (Upload u : uploads) {
            String low = u.name().toLowerCase();
            if (low.endsWith(".zip") || low.endsWith(".jar")) unzip(u.data(), entries, total);
            else add(entries, total, u.name(), u.data());
        }
        String root = stripWrapper(entries);

        List<String> sources = new ArrayList<>();
        Map<String, byte[]> testFiles = new LinkedHashMap<>();
        boolean hasClass = false;
        for (var e : entries.entrySet()) {
            String p = e.getKey();
            if (p.startsWith("tests/")) {
                if (p.matches(".*\\.(java|json|in|out)")) testFiles.put(p, e.getValue());
            } else if (p.endsWith(".java")) sources.add(p);
            else if (p.endsWith(".class")) hasClass = true;
        }
        if (sources.isEmpty()) {
            throw new LoadException("NO_SOURCES", hasClass
                    ? "нужны исходники, а не скомпилированный код"
                    : "не найдено ни одного .java файла");
        }

        JavaParser parser = new JavaParser(new ParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21));
        List<SourceFile> files = new ArrayList<>();
        List<LoadWarning> warnings = new ArrayList<>();
        Map<String, List<String>> byFqn = new LinkedHashMap<>();
        List<String> mains = new ArrayList<>();
        for (String path : sources) {
            byte[] bytes = entries.get(path);
            ParseResult<CompilationUnit> pr = parser.parse(new String(bytes, StandardCharsets.UTF_8));
            if (!pr.isSuccessful() || pr.getResult().isEmpty()) {
                String why = pr.getProblems().isEmpty() ? "ошибка разбора" : pr.getProblems().get(0).getVerboseMessage();
                throw new LoadException("PARSE_ERROR", path + ": " + why);
            }
            CompilationUnit cu = pr.getResult().get();
            String pkg = cu.getPackageDeclaration().map(d -> d.getNameAsString()).orElse("");
            files.add(new SourceFile(path, pkg, bytes));

            // сверяем с полным путём: обёртка может быть первым сегментом пакета (com/demo/A.java)
            String full = root + path;
            int slash = full.lastIndexOf('/');
            String dir = slash < 0 ? "" : full.substring(0, slash);
            String pkgDir = pkg.replace('.', '/');
            // source root = путь минус папки пакета; у пакета по умолчанию подходит любая папка
            if (!pkg.isEmpty() && !(dir.equals(pkgDir) || dir.endsWith("/" + pkgDir))) {
                warnings.add(new LoadWarning("PACKAGE_MISMATCH", path,
                        "package " + pkg + " не совпадает с папкой " + (dir.isEmpty() ? "(корень)" : dir)));
            }
            for (TypeDeclaration<?> t : cu.getTypes()) {
                byFqn.computeIfAbsent(Names.fqn(pkg, t.getNameAsString()), k -> new ArrayList<>()).add(path);
            }
            for (TypeDeclaration<?> t : cu.findAll(TypeDeclaration.class)) {
                if (!t.isTopLevelType() && !t.isNestedType()) continue; // локальные классы
                boolean main = t.getMethods().stream().anyMatch(m ->
                        m.getNameAsString().equals("main") && m.isStatic() && m.getParameters().size() == 1);
                if (main) mains.add(Names.fqn(pkg, Names.binary(t)));
            }
        }
        StringBuilder dup = new StringBuilder();
        List<String> dupFiles = new ArrayList<>();
        byFqn.forEach((fqn, ps) -> {
            if (ps.size() < 2) return;
            dup.append(dup.length() == 0 ? "" : "; ").append(fqn).append(": ").append(String.join(", ", ps));
            ps.stream().filter(p -> !dupFiles.contains(p)).forEach(dupFiles::add);
        });
        if (dup.length() > 0) throw new LoadException("DUPLICATE_FQN", "Классы с одинаковым полным именем: " + dup, dupFiles);
        return new LoadedProject(root, files, warnings, testFiles, mains);
    }

    private static void unzip(byte[] data, Map<String, byte[]> entries, long[] total) {
        try (ZipInputStream zin = new ZipInputStream(new ByteArrayInputStream(data))) {
            for (ZipEntry ze; (ze = zin.getNextEntry()) != null; ) {
                String name = normalize(ze.getName());
                if (ze.isDirectory()) continue;
                // размер считаем по факту чтения, заголовкам архива не верим
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                for (int n; (n = zin.read(buf)) > 0; ) {
                    if (total[0] + n > MAX_BYTES) throw limit();
                    total[0] += n;
                    out.write(buf, 0, n);
                }
                put(entries, name, out.toByteArray());
            }
        } catch (IOException e) {
            throw new LoadException("INVALID_REQUEST", "архив повреждён: " + e.getMessage());
        } catch (IllegalArgumentException e) {
            // ZipInputStream бросает MALFORMED на именах не в UTF-8 (например, CP866)
            throw new LoadException("INVALID_REQUEST", "имена файлов в архиве не в UTF-8: " + e.getMessage());
        }
    }

    private static void add(Map<String, byte[]> entries, long[] total, String rawName, byte[] data) {
        String name = normalize(rawName);
        if (total[0] + data.length > MAX_BYTES) throw limit();
        total[0] += data.length;
        put(entries, name, data);
    }

    private static void put(Map<String, byte[]> entries, String name, byte[] data) {
        if (name.startsWith("__MACOSX/")) return;
        if (entries.size() >= MAX_FILES) throw limit();
        if (entries.put(name, data) != null) throw new LoadException("INVALID_REQUEST", "повторяющийся путь: " + name);
    }

    private static LoadException limit() {
        return new LoadException("LIMIT_EXCEEDED", "превышен лимит: 20 МБ распакованного размера или 2000 файлов");
    }

    /** Нормализует путь; `..`, абсолютные и дисковые пути — ZIP_SLIP. */
    static String normalize(String raw) {
        String s = raw.replace('\\', '/');
        if (s.startsWith("/") || s.matches("^[A-Za-z]:.*")) throw new LoadException("ZIP_SLIP", "абсолютный путь в архиве: " + raw);
        List<String> parts = new ArrayList<>();
        for (String seg : s.split("/")) {
            if (seg.equals("..")) throw new LoadException("ZIP_SLIP", "путь с '..' в архиве: " + raw);
            if (!seg.isEmpty() && !seg.equals(".")) parts.add(seg);
        }
        if (parts.isEmpty()) throw new LoadException("INVALID_REQUEST", "пустой путь: " + raw);
        return String.join("/", parts);
    }

    /** Общая верхняя папка отрезается; возвращает отрезанный префикс ("" или "demo/"). */
    private static String stripWrapper(Map<String, byte[]> entries) {
        String top = null;
        for (String p : entries.keySet()) {
            int i = p.indexOf('/');
            if (i < 0) return "";
            String t = p.substring(0, i);
            if (top == null) top = t;
            else if (!top.equals(t)) return "";
        }
        if (top == null) return "";
        Map<String, byte[]> copy = new LinkedHashMap<>();
        for (var e : entries.entrySet()) copy.put(e.getKey().substring(top.length() + 1), e.getValue());
        entries.clear();
        entries.putAll(copy);
        return top + "/";
    }
}
