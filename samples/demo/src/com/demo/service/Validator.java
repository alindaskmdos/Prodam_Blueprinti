package com.demo.service;

import com.demo.model.Order;
import com.demo.model.OrderLine;
import com.demo.model.Product;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;

/** Order sanity checks collected as small named predicates. */
public class Validator {
    private final Catalog catalog;

    public Validator(Catalog catalog) {
        this.catalog = catalog;
    }

    public static final class Issue {
        private final int orderId;
        private final String text;

        public Issue(int orderId, String text) {
            this.orderId = orderId;
            this.text = text;
        }

        @Override
        public String toString() {
            return "order " + orderId + ": " + text;
        }
    }

    public List<Issue> check(List<Order> orders) {
        List<Issue> issues = new ArrayList<>();
        Predicate<Order> empty = o -> o.getLines().isEmpty();
        Predicate<Order> huge = o -> o.totalQty() > 500;
        for (Order o : orders) {
            if (empty.test(o)) {
                issues.add(new Issue(o.getId(), "no lines"));
            }
            if (huge.test(o)) {
                issues.add(new Issue(o.getId(), "suspicious quantity " + o.totalQty()));
            }
            issues.addAll(checkLines(o));
        }
        return issues;
    }

    private List<Issue> checkLines(Order o) {
        List<Issue> issues = new ArrayList<>();
        List<Integer> seen = new ArrayList<>();
        for (OrderLine l : o.getLines()) {
            if (l.qty() <= 0) {
                issues.add(new Issue(o.getId(), "bad qty for product " + l.productId()));
            }
            // DEFECT LinearSearchInLoop: List.contains inside the loop
            if (seen.contains(l.productId())) {
                issues.add(new Issue(o.getId(), "duplicate product " + l.productId()));
            } else {
                seen.add(l.productId());
            }
            boolean known = false;
            for (Product p : catalog.products()) {
                if (p.getId() == l.productId()) {
                    known = true;
                }
            }
            if (!known) {
                issues.add(new Issue(o.getId(), "unknown product " + l.productId()));
            }
        }
        return issues;
    }
}
