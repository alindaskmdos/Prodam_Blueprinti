package blueprints.analysis;

import java.util.Map;
import java.util.Set;

/**
 * Таблица стоимостей вызовов JDK (§8.1): по простому имени типа получателя, имени метода и числу аргументов.
 * Для статических утилит (Collections, Arrays, String.join) «получатель» — первый аргумент.
 * Неизвестное сочетание → null (вызов считается O(1) и не учитывается детекторами).
 */
public final class JdkCosts {
    public enum Cost { CONSTANT, LOG, LINEAR, N_LOG_N }

    private static final Set<String> LISTS = Set.of("List", "ArrayList", "LinkedList", "Vector", "Collection",
            "CopyOnWriteArrayList", "Deque", "ArrayDeque", "Queue", "Stack");
    private static final Set<String> HASHED = Set.of("Map", "HashMap", "LinkedHashMap", "Set", "HashSet",
            "LinkedHashSet", "ConcurrentHashMap", "Hashtable", "EnumMap", "EnumSet");
    private static final Set<String> TREES = Set.of("TreeMap", "TreeSet", "SortedMap", "SortedSet",
            "NavigableMap", "NavigableSet", "PriorityQueue");
    private static final Set<String> STRINGS = Set.of("String", "StringBuilder", "StringBuffer");

    private static final Set<String> LIST_LINEAR = Set.of("contains", "indexOf", "lastIndexOf", "remove",
            "containsAll", "removeAll", "retainAll", "removeIf", "removeFirstOccurrence", "removeLastOccurrence");
    private static final Set<String> HASH_OPS = Set.of("get", "put", "contains", "containsKey", "add", "remove",
            "getOrDefault", "putIfAbsent", "computeIfAbsent", "computeIfPresent", "compute", "merge");
    private static final Set<String> TREE_OPS = Set.of("get", "put", "contains", "containsKey", "add", "remove",
            "getOrDefault", "putIfAbsent", "computeIfAbsent", "merge", "offer", "poll",
            "floorKey", "ceilingKey", "lowerKey", "higherKey", "floor", "ceiling", "lower", "higher");
    private static final Set<String> STRING_LINEAR = Set.of("contains", "indexOf", "lastIndexOf", "replace",
            "replaceAll", "split", "matches", "toCharArray", "toLowerCase", "toUpperCase", "insert", "reverse",
            "deleteCharAt");
    private static final Map<String, Cost> STATIC = Map.ofEntries(
            Map.entry("Collections.sort", Cost.N_LOG_N), Map.entry("Arrays.sort", Cost.N_LOG_N),
            Map.entry("Arrays.parallelSort", Cost.N_LOG_N),
            Map.entry("Collections.binarySearch", Cost.LOG), Map.entry("Arrays.binarySearch", Cost.LOG),
            Map.entry("Collections.max", Cost.LINEAR), Map.entry("Collections.min", Cost.LINEAR),
            Map.entry("Collections.frequency", Cost.LINEAR), Map.entry("Collections.reverse", Cost.LINEAR),
            Map.entry("Collections.shuffle", Cost.LINEAR), Map.entry("Arrays.fill", Cost.LINEAR),
            Map.entry("Arrays.equals", Cost.LINEAR), Map.entry("String.join", Cost.LINEAR));

    private JdkCosts() {}

    /** Класс стоимости или null, если вызов не из таблицы (O(1)). type — простое имя без дженериков. */
    public static Cost lookup(String type, String method, int argc) {
        if (type == null) return null;
        Cost st = STATIC.get(type + "." + method);
        if (st != null) return st;
        if ("sort".equals(method) && (LISTS.contains(type))) return Cost.N_LOG_N;
        if (LISTS.contains(type)) {
            if (LIST_LINEAR.contains(method) && argc >= 1) return Cost.LINEAR;
            boolean linked = type.equals("LinkedList");
            if (linked && Set.of("get", "set").contains(method)) return Cost.LINEAR;
            if (type.endsWith("List") && !linked && method.equals("add") && argc == 2) return Cost.LINEAR;
            return null;
        }
        if (HASHED.contains(type)) {
            if (method.equals("containsValue")) return Cost.LINEAR;
            return HASH_OPS.contains(method) ? Cost.CONSTANT : null;
        }
        if (TREES.contains(type)) {
            if (method.equals("containsValue")) return Cost.LINEAR;
            if (type.equals("PriorityQueue") && Set.of("contains", "remove").contains(method) && argc == 1) return Cost.LINEAR;
            return TREE_OPS.contains(method) ? Cost.LOG : null;
        }
        if (STRINGS.contains(type) && STRING_LINEAR.contains(method)) return Cost.LINEAR;
        return null;
    }

    /** Стоимость как Big O от размера получателя n. */
    public static BigO cost(String type, String method, int argc, BigO n) {
        Cost c = lookup(type, method, argc);
        if (c == null) return null;
        return switch (c) {
            case CONSTANT -> BigO.ONE;
            case LOG -> n.log();
            case LINEAR -> n;
            case N_LOG_N -> n.times(n.log());
        };
    }

    /** Статический вызов утилиты (получатель — первый аргумент). */
    static boolean isStaticUtility(String type) {
        return STATIC.keySet().stream().anyMatch(k -> k.startsWith(type + "."));
    }
}
