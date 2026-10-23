package com.demo.service;

import com.demo.model.Customer;
import com.demo.model.Order;
import com.demo.model.OrderLine;
import com.demo.model.OrderStatus;
import com.demo.model.Product;
import com.demo.util.Stats;
import com.demo.util.Texts;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

public class ReportService {
    private final Catalog catalog;
    private final OrderService orders;
    private final PricingService pricing;

    public ReportService(Catalog catalog, OrderService orders, PricingService pricing) {
        this.catalog = catalog;
        this.orders = orders;
        this.pricing = pricing;
    }

    /**
     * DEFECT LongMethod (> 50 lines) and StringConcatInLoop (report += ...).
     */
    public String fullReport() {
        String report = "";
        report += "=== ORDERS REPORT ===\n";
        int count = 0;
        long grand = 0;
        int shippedCount = 0;
        int rejectedCount = 0;
        int mergedCount = 0;
        int openCount = 0;
        for (Order o : orders.all()) {
            count++;
            Optional<Customer> c = catalog.findCustomer(o.getCustomerId());
            String who = c.isPresent() ? c.get().label() : "unknown";
            long total = pricing.total(o);
            report += Texts.padLeft(String.valueOf(o.getId()), 4) + " ";
            report += Texts.padRight(who, 14) + " ";
            report += Texts.padLeft(Texts.money(total), 10) + " ";
            report += o.getStatus();
            if (!o.getNote().isEmpty()) {
                report += " (" + o.getNote() + ")";
            }
            report += "\n";
            switch (o.getStatus()) {
                case SHIPPED:
                    shippedCount++;
                    grand += total;
                    break;
                case REJECTED:
                    rejectedCount++;
                    break;
                case MERGED:
                    mergedCount++;
                    break;
                default:
                    openCount++;
                    break;
            }
        }
        report += Texts.repeat('-', 40) + "\n";
        report += "orders:   " + count + "\n";
        report += "shipped:  " + shippedCount + "\n";
        report += "rejected: " + rejectedCount + "\n";
        report += "merged:   " + mergedCount + "\n";
        report += "open:     " + openCount + "\n";
        report += "revenue:  " + Texts.money(grand) + "\n";
        List<Order> live = new ArrayList<>();
        for (Order o : orders.all()) {
            if (o.getStatus() != OrderStatus.MERGED) {
                live.add(o);
            }
        }
        report += "avg qty:  " + String.format("%.2f", Stats.average(live, Order::totalQty)) + "\n";
        report += "max qty:  " + Stats.max(live, Order::totalQty) + "\n";
        report += "=== END ===\n";
        return report;
    }

    /**
     * DEFECT DeepNesting (depth > 3): for / for / if / for / if.
     */
    public List<String> hotProducts(int minQty) {
        List<String> hot = new ArrayList<>();
        for (Product p : catalog.products()) {
            int qty = 0;
            for (Order o : orders.all()) {
                if (o.getStatus() == OrderStatus.SHIPPED) {
                    for (OrderLine l : o.getLines()) {
                        if (l.productId() == p.getId()) {
                            if (l.qty() > 0) {
                                qty += l.qty();
                            }
                        }
                    }
                }
            }
            if (qty >= minQty) {
                hot.add(p.getName() + "=" + qty);
            }
        }
        return hot;
    }

    public String customerSummary(int customerId) {
        Customer c = catalog.findCustomer(customerId)
                .orElseThrow(() -> new IllegalArgumentException("unknown customer " + customerId));
        int n = 0;
        long sum = 0;
        for (Order o : orders.all()) {
            if (o.getCustomerId() == customerId && o.getStatus() == OrderStatus.SHIPPED) {
                n++;
                sum += pricing.total(o);
            }
        }
        return c.label() + ": " + n + " shipped, " + Texts.money(sum);
    }

    public String stockTable() {
        StringBuilder sb = new StringBuilder();
        for (Product p : catalog.products()) {
            sb.append(Texts.padRight(p.getName(), 12))
                    .append(Texts.padLeft(String.valueOf(p.getStock()), 5))
                    .append(Texts.padLeft(Texts.money(p.getPriceCents()), 8))
                    .append('\n');
        }
        return sb.toString();
    }
}
