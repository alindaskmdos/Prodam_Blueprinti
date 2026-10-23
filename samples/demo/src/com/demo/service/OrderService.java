package com.demo.service;

import com.demo.model.Order;
import com.demo.model.OrderLine;
import com.demo.model.OrderStatus;
import com.demo.model.Pair;

import java.util.ArrayList;
import java.util.List;

public class OrderService {
    private final Catalog catalog;
    private final InventoryService inventory;
    private final List<Order> orders = new ArrayList<>();

    public OrderService(Catalog catalog, InventoryService inventory) {
        this.catalog = catalog;
        this.inventory = inventory;
    }

    public Order create(int id, int customerId, List<OrderLine> lines) {
        if (catalog.findCustomer(customerId).isEmpty()) {
            throw new IllegalArgumentException("unknown customer " + customerId);
        }
        Order o = new Order(id, customerId);
        for (OrderLine l : lines) {
            o.addLine(l);
        }
        orders.add(o);
        return o;
    }

    /**
     * DEFECT NestedLoopSameCollection: O(n*n) scan of the same list by customer id.
     * Fix would be an index customerId -> first order (LinkedHashMap).
     */
    public int merge() {
        int merged = 0;
        for (int i = 0; i < orders.size(); i++) {
            Order a = orders.get(i);
            if (!a.getStatus().canMerge()) {
                continue;
            }
            for (int j = i + 1; j < orders.size(); j++) {
                Order b = orders.get(j);
                if (b.getStatus().canMerge() && a.getCustomerId() == b.getCustomerId()) {
                    absorb(a, b);
                    b.setStatus(OrderStatus.MERGED);
                    b.setNote("merged into " + a.getId());
                    merged++;
                }
            }
        }
        return merged;
    }

    private void absorb(Order target, Order source) {
        for (OrderLine incoming : source.getLines()) {
            boolean found = false;
            List<OrderLine> mine = target.getLines();
            for (int k = 0; k < mine.size(); k++) {
                if (mine.get(k).productId() == incoming.productId()) {
                    mine.set(k, mine.get(k).plus(incoming));
                    found = true;
                    break;
                }
            }
            if (!found) {
                target.addLine(incoming);
            }
        }
    }

    public int reserveAll() {
        int ok = 0;
        for (Order o : orders) {
            if (o.getStatus() == OrderStatus.NEW && inventory.reserve(o)) {
                ok++;
            }
        }
        return ok;
    }

    public int shipReserved() {
        int shipped = 0;
        Order[] snapshot = orders.toArray(new Order[0]);
        int i = 0;
        do {
            if (snapshot.length == 0) {
                break;
            }
            if (snapshot[i].getStatus() == OrderStatus.RESERVED) {
                snapshot[i].setStatus(OrderStatus.SHIPPED);
                shipped++;
            }
            i++;
        } while (i < snapshot.length);
        return shipped;
    }

    public void cancel(int orderId) {
        Order o = find(orderId);
        try {
            if (o.getStatus().isFinal()) {
                throw new IllegalStateException("order " + orderId + " is final");
            }
            o.setStatus(OrderStatus.REJECTED);
            o.setNote("cancelled");
        } finally {
            inventory.journal().add("cancel attempt " + orderId);
        }
    }

    public Order find(int orderId) {
        for (Order o : orders) {
            if (o.getId() == orderId) {
                return o;
            }
        }
        throw new IllegalArgumentException("no order " + orderId);
    }

    public Pair<Integer, Integer> counts() {
        int active = 0;
        int done = 0;
        for (Order o : orders) {
            if (o.getStatus().isFinal()) {
                done++;
            } else {
                active++;
            }
        }
        return new Pair<>(active, done);
    }

    public List<Order> all() {
        return orders;
    }
}
