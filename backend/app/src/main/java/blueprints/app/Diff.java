package blueprints.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Unified diff по строкам (3 строки контекста) для FixResult.diff. */
final class Diff {
    private Diff() {}

    /** Пусто, если тексты равны. ponytail: LCS O(n·m) по строкам и без «\ No newline» — хватает для файлов в тысячи строк. */
    static String unified(String path, String before, String after) {
        List<String> a = lines(before), b = lines(after);
        int n = a.size(), m = b.size();
        int[][] lcs = new int[n + 1][m + 1];
        for (int i = n - 1; i >= 0; i--) {
            for (int j = m - 1; j >= 0; j--) {
                lcs[i][j] = a.get(i).equals(b.get(j)) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
            }
        }
        List<String> ops = new ArrayList<>(); // строка с префиксом ' ', '-', '+'
        for (int i = 0, j = 0; i < n || j < m; ) {
            if (i < n && j < m && a.get(i).equals(b.get(j))) {
                ops.add(" " + a.get(i++));
                j++;
            } else if (i < n && (j == m || lcs[i + 1][j] >= lcs[i][j + 1])) ops.add("-" + a.get(i++));
            else ops.add("+" + b.get(j++));
        }
        int size = ops.size();
        int[] oldAt = new int[size + 1], newAt = new int[size + 1]; // номер строки (с 0) перед ops[k]
        for (int k = 0; k < size; k++) {
            char c = ops.get(k).charAt(0);
            oldAt[k + 1] = oldAt[k] + (c != '+' ? 1 : 0);
            newAt[k + 1] = newAt[k] + (c != '-' ? 1 : 0);
        }
        StringBuilder out = new StringBuilder();
        for (int k = 0; k < size; ) {
            if (ops.get(k).charAt(0) == ' ') {
                k++;
                continue;
            }
            int start = Math.max(0, k - 3), end = k, e = k;
            while (e < size) {
                if (ops.get(e).charAt(0) != ' ') {
                    end = ++e;
                    continue;
                }
                int r = e;
                while (r < size && ops.get(r).charAt(0) == ' ') r++;
                if (r == size || r - e > 6) break; // разрыв больше двух контекстов — новый hunk
                e = r;
            }
            int stop = Math.min(size, end + 3);
            if (out.isEmpty()) out.append("--- a/").append(path).append("\n+++ b/").append(path).append('\n');
            out.append("@@ -").append(range(oldAt[start], oldAt[stop] - oldAt[start]))
                    .append(" +").append(range(newAt[start], newAt[stop] - newAt[start])).append(" @@\n");
            for (int t = start; t < stop; t++) out.append(ops.get(t)).append('\n');
            k = stop;
        }
        return out.toString();
    }

    private static String range(int from, int len) {
        return (len == 0 ? from : from + 1) + "," + len;
    }

    private static List<String> lines(String s) {
        if (s == null || s.isEmpty()) return List.of();
        List<String> l = new ArrayList<>(Arrays.asList(s.split("\n", -1)));
        if (s.endsWith("\n")) l.remove(l.size() - 1);
        return l;
    }
}
