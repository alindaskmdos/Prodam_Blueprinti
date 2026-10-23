package com.demo;

import com.demo.model.Order;
import com.demo.model.OrderLine;
import com.demo.model.Product;
import com.demo.service.Catalog;
import com.demo.service.InventoryService;
import com.demo.service.OrderService;
import com.demo.service.PricingService;
import com.demo.service.ReportService;
import com.demo.service.Validator;
import com.demo.util.CommandLine;
import com.demo.util.Texts;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Console shop: reads commands from stdin, prints deterministic output.
 *
 * Commands: CUSTOMER id name tier | PRODUCT id name cents stock |
 * ORDER id customerId prod:qty,prod:qty | MERGE | RESERVE | SHIP | CANCEL id |
 * RESTOCK id qty | WATCH id,id | REPORT | STOCK | VALIDATE | HOT minQty | SUMMARY id
 */
public class Main {
    private final Catalog catalog = new Catalog();
    private final InventoryService inventory = new InventoryService(catalog);
    private final OrderService orders = new OrderService(catalog, inventory);
    private final PricingService pricing = new PricingService(catalog);
    private final ReportService reports = new ReportService(catalog, orders, pricing);
    private final Validator validator = new Validator(catalog);
    private int errors = 0;

    public static void main(String[] args) throws IOException {
        Main app = new Main();
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        int lineNo = 0;
        while ((line = in.readLine()) != null) {
            lineNo++;
            app.handle(lineNo, line);
        }
        out("done, errors=" + app.errors);
        if (app.errors > 3) {
            System.exit(2);
        }
    }

    /** Always LF, so output is identical on every OS. */
    private static void out(String s) {
        System.out.print(s + "\n");
    }

    private void handle(int lineNo, String raw) {
        CommandLine cmd = CommandLine.parse(raw);
        if (cmd == null) {
            return;
        }
        try {
            dispatch(cmd);
        } catch (IllegalArgumentException | IllegalStateException e) {
            errors++;
            out("error line " + lineNo + ": " + e.getMessage());
        } catch (IndexOutOfBoundsException e) {
            errors++;
            out("error line " + lineNo + ": missing arguments");
        }
    }

    private void dispatch(CommandLine cmd) {
        switch (cmd.verb()) {
            case "CUSTOMER":
                catalog.addCustomer(cmd.intArg(0), cmd.arg(1), cmd.size() > 2 ? cmd.arg(2) : "std");
                break;
            case "PRODUCT":
                catalog.addProduct(cmd.intArg(0), cmd.arg(1), cmd.intArg(2), cmd.intArg(3));
                break;
            case "ORDER":
                Order o = orders.create(cmd.intArg(0), cmd.intArg(1), parseLines(cmd.arg(2)));
                out("created " + o.summary());
                break;
            case "MERGE":
                out("merged " + orders.merge());
                break;
            case "RESERVE":
                out("reserved " + orders.reserveAll());
                break;
            case "SHIP":
                out("shipped " + orders.shipReserved());
                break;
            case "CANCEL":
                orders.cancel(cmd.intArg(0));
                out("cancelled " + cmd.arg(0));
                break;
            case "RESTOCK":
                inventory.restock(cmd.intArg(0), cmd.intArg(1));
                break;
            case "WATCH":
                printWatched(cmd.arg(0));
                break;
            case "REPORT":
                System.out.print(reports.fullReport());
                break;
            case "STOCK":
                System.out.print(reports.stockTable());
                break;
            case "VALIDATE":
                printIssues();
                break;
            case "HOT":
                out("hot: " + Texts.join(reports.hotProducts(cmd.intArg(0)), ", "));
                break;
            case "SUMMARY":
                out(reports.customerSummary(cmd.intArg(0)));
                break;
            default:
                throw new IllegalArgumentException("unknown command " + cmd.verb());
        }
    }

    private List<OrderLine> parseLines(String spec) {
        List<OrderLine> lines = new ArrayList<>();
        for (String part : spec.split(",")) {
            String[] kv = part.split(":");
            if (kv.length != 2 || !Texts.isInt(kv[0]) || !Texts.isInt(kv[1])) {
                throw new IllegalArgumentException("bad line spec " + part);
            }
            lines.add(new OrderLine(Integer.parseInt(kv[0]), Integer.parseInt(kv[1])));
        }
        return lines;
    }

    private void printWatched(String idList) {
        List<Integer> ids = new ArrayList<>();
        for (String s : idList.split(",")) {
            ids.add(Integer.parseInt(s));
        }
        List<Integer> distinct = inventory.distinctIds(ids);
        List<String> names = new ArrayList<>();
        for (Product p : inventory.watched(distinct)) {
            names.add(p.getName() + "(" + p.getStock() + ")");
        }
        out("watch " + distinct.size() + ": " + Texts.join(names, " "));
    }

    private void printIssues() {
        List<Validator.Issue> issues = validator.check(orders.all());
        if (issues.isEmpty()) {
            out("no issues");
            return;
        }
        issues.forEach(i -> out("issue " + i));
    }
}
