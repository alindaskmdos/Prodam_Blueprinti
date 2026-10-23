package com.demo.service;

import com.demo.model.Order;
import com.demo.model.OrderLine;
import com.demo.model.OrderStatus;
import com.demo.model.Product;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

public class InventoryService {
    private final Catalog catalog;
    private final List<String> journal = new ArrayList<>();

    public InventoryService(Catalog catalog) {
        this.catalog = catalog;
    }

    /** Reserves stock for every line; rolls back on the first failure. */
    public boolean reserve(Order order) {
        List<OrderLine> taken = new ArrayList<>();
        for (OrderLine line : order.getLines()) {
            Optional<Product> p = catalog.findProduct(line.productId());
            if (p.isEmpty()) {
                rollback(taken);
                order.setNote("unknown product " + line.productId());
                order.setStatus(OrderStatus.REJECTED);
                return false;
            }
            if (!p.get().take(line.qty())) {
                rollback(taken);
                order.setNote("out of stock " + p.get().getName());
                order.setStatus(OrderStatus.REJECTED);
                return false;
            }
            taken.add(line);
        }
        order.setStatus(OrderStatus.RESERVED);
        journal.add("reserved " + order.getId());
        return true;
    }

    private void rollback(List<OrderLine> taken) {
        for (OrderLine l : taken) {
            catalog.findProduct(l.productId()).ifPresent(p -> p.give(l.qty()));
        }
    }

    public void restock(int productId, int qty) {
        Product p = catalog.findProduct(productId)
                .orElseThrow(() -> new IllegalArgumentException("no product " + productId));
        p.give(qty);
        journal.add("restock " + productId + " +" + qty);
    }

    /**
     * DEFECT LinearSearchInLoop: watch.contains(...) on a List inside a loop.
     */
    public List<Product> watched(List<Integer> watch) {
        List<Product> result = new ArrayList<>();
        for (Product p : catalog.products()) {
            if (watch.contains(p.getId())) {
                result.add(p);
            }
        }
        return result;
    }

    /**
     * DEFECT LinearSearchInLoop: indexOf on a List inside a loop (dedup by hand).
     */
    public List<Integer> distinctIds(List<Integer> ids) {
        List<Integer> out = new ArrayList<>();
        for (int i = 0; i < ids.size(); i++) {
            Integer id = ids.get(i);
            if (out.indexOf(id) < 0) {
                out.add(id);
            }
        }
        return out;
    }

    public List<Product> lowStock(int threshold) {
        List<Product> low = new ArrayList<>();
        catalog.products().forEach(p -> {
            if (p.getStock() <= threshold) {
                low.add(p);
            }
        });
        return low;
    }

    public List<String> journal() {
        return journal;
    }
}
