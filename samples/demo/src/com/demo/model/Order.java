package com.demo.model;

import java.util.ArrayList;
import java.util.List;

public class Order {
    private final int id;
    private final int customerId;
    private final List<OrderLine> lines = new ArrayList<>();
    private OrderStatus status = OrderStatus.NEW;
    private String note = "";

    public Order(int id, int customerId) {
        this.id = id;
        this.customerId = customerId;
    }

    public int getId() {
        return id;
    }

    public int getCustomerId() {
        return customerId;
    }

    public List<OrderLine> getLines() {
        return lines;
    }

    public OrderStatus getStatus() {
        return status;
    }

    public void setStatus(OrderStatus status) {
        this.status = status;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public void addLine(OrderLine line) {
        lines.add(line);
    }

    public int totalQty() {
        int sum = 0;
        for (OrderLine l : lines) {
            sum += l.qty();
        }
        return sum;
    }

    /** Small helper class nested inside the model. */
    public static class Summary {
        public final int orderId;
        public final int lineCount;

        public Summary(int orderId, int lineCount) {
            this.orderId = orderId;
            this.lineCount = lineCount;
        }

        @Override
        public String toString() {
            return "order " + orderId + " lines=" + lineCount;
        }
    }

    public Summary summary() {
        return new Summary(id, lines.size());
    }
}
