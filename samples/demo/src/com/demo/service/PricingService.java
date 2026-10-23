package com.demo.service;

import com.demo.model.Customer;
import com.demo.model.Order;
import com.demo.model.OrderLine;
import com.demo.model.Product;

import java.util.Optional;
import java.util.function.LongUnaryOperator;

public class PricingService {
    private final Catalog catalog;
    private final LongUnaryOperator rounding = cents -> (cents / 5) * 5;

    public PricingService(Catalog catalog) {
        this.catalog = catalog;
    }

    public interface Rule {
        long apply(long cents, int qty);
    }

    /** Bulk rule: switch over quantity ranges. */
    public long bulk(long cents, int qty) {
        int bucket = qty >= 100 ? 3 : qty >= 20 ? 2 : qty >= 5 ? 1 : 0;
        long result;
        switch (bucket) {
            case 3:
                result = cents * 80 / 100;
                break;
            case 2:
                result = cents * 90 / 100;
                break;
            case 1:
                result = cents * 95 / 100;
                break;
            default:
                result = cents;
                break;
        }
        return result;
    }

    public long lineTotal(OrderLine line) {
        Optional<Product> p = catalog.findProduct(line.productId());
        if (p.isEmpty()) {
            return 0L;
        }
        long unit = bulk(p.get().getPriceCents(), line.qty());
        return unit * line.qty();
    }

    public long subtotal(Order order) {
        long total = 0;
        for (OrderLine l : order.getLines()) {
            total += lineTotal(l);
        }
        return total;
    }

    public long total(Order order) {
        long sub = subtotal(order);
        Optional<Customer> c = catalog.findCustomer(order.getCustomerId());
        int percent = c.map(cu -> cu.tier().discountPercent()).orElse(0);
        long discounted = sub - sub * percent / 100;
        return rounding.applyAsLong(discounted);
    }

    public String describe(Rule rule, long cents, int qty) {
        long r = rule.apply(cents, qty);
        return cents + "->" + r;
    }

    public static Rule flat(long off) {
        return (cents, qty) -> Math.max(0, cents - off);
    }

    public static Rule percent(int pct) {
        return new Rule() {
            @Override
            public long apply(long cents, int qty) {
                return cents * (100 - pct) / 100;
            }
        };
    }
}
