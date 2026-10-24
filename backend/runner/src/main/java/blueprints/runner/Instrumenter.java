package blueprints.runner;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.Position;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.CatchClause;
import com.github.javaparser.ast.stmt.DoStmt;
import com.github.javaparser.ast.stmt.ExplicitConstructorInvocationStmt;
import com.github.javaparser.ast.stmt.ForEachStmt;
import com.github.javaparser.ast.stmt.ForStmt;
import com.github.javaparser.ast.stmt.IfStmt;
import com.github.javaparser.ast.stmt.Statement;
import com.github.javaparser.ast.stmt.SwitchEntry;
import com.github.javaparser.ast.stmt.SwitchStmt;
import com.github.javaparser.ast.stmt.TryStmt;
import com.github.javaparser.ast.stmt.WhileStmt;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Инструментация копии для запуска (§14а.6): перед каждой нодой дерева блоков — {@code __blueprints.Trace.hit(id);}.
 * Ноды — как у AstToBlocks: метод/конструктор, операторы тела, case, catch; внутрь raw (вложенный {@code {}}, метка,
 * synchronized, локальный класс), выражений (лямбды, анонимные классы, switch-выражения) не заходит.
 * Вставки — в той же строке, номера строк (stack trace) не меняются. Исходники пользователя не трогает.
 */
public final class Instrumenter {

    /**
     * Нода с индексом {@code id} = позиция в {@link Result#probes()}.
     *
     * @param methodId id метода как в дереве проекта ({@code pkg.Outer$Inner.m~N}, {@code <init>~N})
     * @param path     путь в дереве блоков метода: {@code ""} — сам метод, {@code body/0/then/1}, {@code body/2/cases/0},
     *                 {@code .../catches/0}, {@code .../finally/0}; индексы — <b>без блоков comment</b>
     * @param line     начало ноды в исходном тексте, строки и столбцы с 1
     */
    public record Probe(String file, String methodId, String path, int line, int column) {}

    /** {@code sources} — копия с вставками и {@code __blueprints/Trace.java}. */
    public record Result(Map<String, String> sources, List<Probe> probes) {}

    static final String TRACE_FILE = "/tmp/__blueprints.trace";
    private static final String HIT = "__blueprints.Trace.hit(";

    private Instrumenter() {}

    /**
     * Детерминирована: файлы — по пути, ноды — в порядке обхода. Файл, который JavaParser не разбирает или на котором
     * вставка падает (в т.ч. StackOverflowError на глубокой вложенности), — без вставок и без нод в таблице.
     */
    public static Result instrument(Map<String, String> sources) {
        JavaParser parser = new JavaParser(new ParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21));
        List<Probe> probes = new ArrayList<>();
        Map<String, String> out = new LinkedHashMap<>();
        for (var e : new TreeMap<>(sources).entrySet()) {
            int mark = probes.size();
            String text = e.getValue();
            try {
                var pr = parser.parse(e.getValue());
                if (pr.isSuccessful() && pr.getResult().isPresent()) {
                    File f = new File(e.getKey(), e.getValue(), probes);
                    CompilationUnit cu = pr.getResult().get();
                    String pkg = cu.getPackageDeclaration().map(p -> p.getNameAsString() + ".").orElse("");
                    for (TypeDeclaration<?> t : cu.getTypes()) f.type(t, pkg);
                    text = f.apply();
                }
            } catch (RuntimeException | StackOverflowError ex) {
                // код пользователя не должен ломаться из-за инструментации: файл идёт как есть
                probes.subList(mark, probes.size()).clear();
                text = e.getValue();
            }
            out.put(e.getKey(), text);
        }
        out.put("__blueprints/Trace.java", traceSource(probes.size()));
        return new Result(out, probes);
    }

    // ponytail: counts[i]++ без синхронизации — в многопоточной программе счёт приблизительный, факт покрытия верный.
    static String traceSource(int n) {
        return "package __blueprints;\n"
                + "public final class Trace {\n"
                + "  private static final long[] C = new long[" + Math.max(n, 1) + "];\n"
                + "  static {\n"
                + "    try { Runtime.getRuntime().addShutdownHook(new Thread(Trace::dump)); } catch (Throwable e) { }\n"
                + "  }\n"
                + "  public static void hit(int i) { C[i]++; }\n"
                + "  private static void dump() {\n"
                + "    StringBuilder s = new StringBuilder();\n"
                + "    for (int i = 0; i < C.length; i++) if (C[i] != 0) s.append(i).append(' ').append(C[i]).append('\\n');\n"
                + "    s.append(\"" + END + "\\n\");\n"
                // во временный файл + атомарный rename: SIGKILL посреди записи не оставит обрезанный файл
                + "    try {\n"
                + "      java.nio.file.Path t = java.nio.file.Path.of(\"" + TRACE_FILE + ".tmp\");\n"
                + "      java.nio.file.Files.writeString(t, s);\n"
                + "      java.nio.file.Files.move(t, java.nio.file.Path.of(\"" + TRACE_FILE + "\"),"
                + " java.nio.file.StandardCopyOption.ATOMIC_MOVE);\n"
                + "    } catch (Throwable e) { }\n"
                + "  }\n"
                + "}\n";
    }

    /** Последняя строка файла Trace: без неё файл обрезан. */
    private static final String END = "end";

    /** Разбор вывода Trace: строки {@code id count} и {@code end}; null — файл битый или обрезанный; id вне таблицы пропускаются. */
    static long[] parseHits(String text, int n) {
        if (!text.endsWith(END + "\n")) return null;
        long[] hits = new long[n];
        String[] lines = text.split("\n");
        for (int k = 0; k < lines.length - 1; k++) {
            String[] p = lines[k].split(" ");
            try {
                int i = Integer.parseInt(p[0]);
                if (p.length != 2) return null;
                long c = Long.parseLong(p[1]);
                if (i >= 0 && i < n) hits[i] = c;
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return lines[lines.length - 1].equals(END) ? hits : null;
    }

    private record Edit(int offset, String text) {}

    private static final class File {
        final String path, text;
        final List<Probe> probes;
        final List<Edit> edits = new ArrayList<>();
        final int[] lineStart;
        String methodId;

        File(String path, String text, List<Probe> probes) {
            this.path = path;
            this.text = text;
            this.probes = probes;
            List<Integer> starts = new ArrayList<>(List.of(0));
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                if (c == '\n' || c == '\r' && (i + 1 >= text.length() || text.charAt(i + 1) != '\n')) starts.add(i + 1);
            }
            lineStart = starts.stream().mapToInt(Integer::intValue).toArray();
        }

        int offset(Position p) {
            return lineStart[p.line - 1] + p.column - 1;
        }

        int begin(Node n) {
            return offset(n.getBegin().orElseThrow());
        }

        int after(Node n) {
            return offset(n.getEnd().orElseThrow()) + 1;
        }

        /** Новая нода: id и вставка {@code hit(id);} в позицию at. */
        String hit(Node n, String nodePath) {
            Position b = n.getBegin().orElseThrow();
            probes.add(new Probe(path, methodId, nodePath, b.line, b.column));
            return HIT + (probes.size() - 1) + "); ";
        }

        void insert(int at, String s) {
            edits.add(new Edit(at, s));
        }

        /** Как TreeBuilder: классы с вложенными (Outer$Inner), конструкторы, методы с индексом перегрузки. */
        void type(TypeDeclaration<?> t, String prefix) {
            String fqn = prefix + t.getNameAsString();
            int k = 0;
            for (ConstructorDeclaration c : t.getConstructors()) callable(c, c.getBody(), fqn + ".<init>~" + k++);
            Map<String, Integer> idx = new HashMap<>();
            for (MethodDeclaration m : t.getMethods()) {
                int i = idx.merge(m.getNameAsString(), 1, Integer::sum) - 1;
                if (m.getBody().isPresent()) callable(m, m.getBody().get(), fqn + "." + m.getNameAsString() + "~" + i);
            }
            t.getMembers().forEach(m -> { if (m instanceof TypeDeclaration<?> n) type(n, fqn + "$"); });
        }

        void callable(CallableDeclaration<?> decl, BlockStmt body, String id) {
            methodId = id;
            List<Statement> stmts = body.getStatements();
            // §14а.6: в конструкторе — после super(...)/this(...)
            if (!stmts.isEmpty() && stmts.get(0) instanceof ExplicitConstructorInvocationStmt call) {
                int at = after(call);
                insert(at, hit(decl, ""));
                insert(at, hit(call, "body/0"));
                seq(stmts.subList(1, stmts.size()), "body", 1);
            } else {
                insert(begin(body) + 1, hit(decl, ""));
                seq(stmts, "body", 0);
            }
        }

        void seq(List<Statement> stmts, String slot, int from) {
            for (int i = 0; i < stmts.size(); i++) stmt(stmts.get(i), slot + "/" + (from + i), false);
        }

        /** Тело if/цикла: блок раскрывается, одиночный оператор оборачивается в {@code { }}. */
        void slot(Statement s, String slot) {
            if (s instanceof BlockStmt b) seq(b.getStatements(), slot, 0);
            else stmt(s, slot + "/0", true);
        }

        void stmt(Statement s, String p, boolean wrap) {
            insert(begin(s), (wrap ? "{ " : "") + hit(s, p));
            String in = p + "/";
            if (s instanceof IfStmt i) {
                slot(i.getThenStmt(), in + "then");
                i.getElseStmt().ifPresent(e -> slot(e, in + "else"));
            } else if (s instanceof WhileStmt w) {
                slot(w.getBody(), in + "body");
            } else if (s instanceof DoStmt d) {
                slot(d.getBody(), in + "body");
            } else if (s instanceof ForStmt f) {
                slot(f.getBody(), in + "body");
            } else if (s instanceof ForEachStmt f) {
                slot(f.getBody(), in + "body");
            } else if (s instanceof SwitchStmt sw) {
                for (int k = 0; k < sw.getEntries().size(); k++) entry(sw.getEntries().get(k), in + "cases/" + k);
            } else if (s instanceof TryStmt t) {
                seq(t.getTryBlock().getStatements(), in + "body", 0);
                for (int k = 0; k < t.getCatchClauses().size(); k++) {
                    CatchClause c = t.getCatchClauses().get(k);
                    insert(begin(c.getBody()) + 1, hit(c, in + "catches/" + k));
                    seq(c.getBody().getStatements(), in + "catches/" + k + "/body", 0);
                }
                t.getFinallyBlock().ifPresent(b -> seq(b.getStatements(), in + "finally", 0));
            }
            if (wrap) insert(after(s), " }");
        }

        /** case: {@code case X:} — после двоеточия; {@code -> { }} — после {@code {}; {@code -> expr;} — оборачивается в блок. */
        void entry(SwitchEntry e, String p) {
            List<Statement> st = e.getStatements();
            String body = p + "/body";
            switch (e.getType()) {
                case STATEMENT_GROUP -> {
                    insert(st.isEmpty() ? after(e) : begin(st.get(0)), hit(e, p));
                    seq(st, body, 0);
                }
                case BLOCK -> {
                    BlockStmt b = (BlockStmt) st.get(0);
                    insert(begin(b) + 1, hit(e, p));
                    seq(b.getStatements(), body, 0);
                }
                default -> { // EXPRESSION, THROWS_STATEMENT: единственный оператор
                    Statement s = st.get(0);
                    insert(begin(s), "{ " + hit(e, p));
                    stmt(s, body + "/0", false);
                    // в case X -> expr; JavaParser не включает ';' в диапазон ни оператора, ни case
                    var tok = s.getTokenRange().orElseThrow().getEnd();
                    while (!tok.getText().equals(";")) tok = tok.getNextToken().orElseThrow();
                    insert(offset(tok.getRange().orElseThrow().end) + 1, " }");
                }
            }
        }

        /** Вставки по смещению; при равном — в порядке обхода (открывающие до вложенных, закрывающие — после). */
        String apply() {
            List<Edit> sorted = new ArrayList<>(edits);
            sorted.sort(Comparator.comparingInt(Edit::offset)); // стабильная
            StringBuilder sb = new StringBuilder(text.length() + sorted.size() * 32);
            int pos = 0;
            for (Edit ed : sorted) {
                sb.append(text, pos, ed.offset()).append(ed.text());
                pos = ed.offset();
            }
            return sb.append(text, pos, text.length()).toString();
        }
    }
}
