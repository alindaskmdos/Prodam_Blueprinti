import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class CollectionsDemo {
    public static void main(String[] args) {
        List<String> list = new ArrayList<>(List.of("delta", "alpha", "charlie", "bravo", "echo"));
        java.util.Collections.sort(list);
        System.out.println(list);
        list.sort(Comparator.comparing(String::length).thenComparing(Comparator.reverseOrder()));
        System.out.println(list);
        java.util.Collections.sort(list, new Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                return b.charAt(1) - a.charAt(1);
            }
        });
        System.out.println(list);
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (String w : "b a c a b a".split(" ")) {
            counts.put(w, counts.getOrDefault(w, 0) + 1);
        }
        counts.merge("z", 1, Integer::sum);
        counts.computeIfAbsent("y", k -> 7);
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            System.out.print(e.getKey() + "=" + e.getValue() + " ");
        }
        System.out.println();
        Set<Integer> seen = new LinkedHashSet<>();
        for (int x : new int[]{5, 3, 5, 1, 3, 9}) {
            if (!seen.add(x)) System.out.print("dup" + x + " ");
        }
        System.out.println(seen);
        Deque<Integer> stack = new ArrayDeque<>();
        Deque<Integer> queue = new ArrayDeque<>();
        for (int i = 1; i <= 4; i++) {
            stack.push(i);
            queue.offer(i);
        }
        System.out.println("pop=" + stack.pop() + " poll=" + queue.poll() + " peek=" + stack.peek() + " " + queue);
        List<Integer> nums = new ArrayList<>(List.of(1, 2, 3, 4, 5, 6, 7));
        Iterator<Integer> it = nums.iterator();
        while (it.hasNext()) {
            int v = it.next();
            if (v % 3 == 0) {
                it.remove();
            }
        }
        System.out.println(nums);
        List<Integer> rev = new ArrayList<>(nums);
        java.util.Collections.reverse(rev);
        System.out.println(rev + " max=" + java.util.Collections.max(rev) + " idx=" + rev.indexOf(4));
    }
}
