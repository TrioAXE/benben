<?php
require __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');

function out(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(string $msg, int $code = 400): void {
    out(['ok' => false, 'error' => $msg], $code);
}
function requireAdmin(): void {
    $key = $_SERVER['HTTP_X_ADMIN_KEY'] ?? '';
    if (!hash_equals(ADMIN_PASSWORD, $key)) fail('Wrong password', 401);
}

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER, DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
         PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
} catch (PDOException $e) {
    fail('Database connection failed. Is MySQL running in XAMPP and was database.sql imported?', 500);
}

$action = $_GET['action'] ?? '';
$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in)) $in = [];

const NEXT = [
    'New'       => ['Preparing', 'Cancelled'],
    'Preparing' => ['Ready', 'Cancelled'],
    'Ready'     => ['Completed'],
    'Completed' => [],
    'Cancelled' => [],
];

function formatOrders(PDO $pdo, array $rows): array {
    if (!$rows) return [];
    $ids = array_column($rows, 'id');
    $ph  = implode(',', array_fill(0, count($ids), '?'));
    $st  = $pdo->prepare("SELECT order_id, item_name, qty, subtotal FROM order_items WHERE order_id IN ($ph) ORDER BY id");
    $st->execute($ids);
    $lines = [];
    foreach ($st as $l) {
        $lines[$l['order_id']][] = [
            'name' => $l['item_name'], 'qty' => (int)$l['qty'], 'subtotal' => (float)$l['subtotal'],
        ];
    }
    return array_map(fn($r) => [
        'no'     => $r['order_no'],
        'name'   => $r['customer_name'],
        'type'   => $r['order_type'],
        'ref'    => $r['ref'],
        'time'   => $r['created_at'],          // "YYYY-MM-DD HH:MM:SS"
        'status' => $r['status'],
        'total'  => (float)$r['total'],
        'lines'  => $lines[$r['id']] ?? [],
    ], $rows);
}

function menuRow(array $r): array {
    return [
        'id'        => (int)$r['id'],
        'cat'       => $r['category'],
        'name'      => $r['name'],
        'desc'      => $r['description'],
        'diet'      => $r['diet'] === '' ? [] : explode(',', $r['diet']),
        'price'     => (float)$r['price'],
        'available' => (bool)$r['available'],
    ];
}
const MENU_ORDER = "ORDER BY (SELECT MIN(x.sort_order) FROM menu_items x WHERE x.category = m.category), m.sort_order, m.id";

try {
    switch ($action) {

    // ---------- Public: menu ----------
    case 'menu':
        $rows = $pdo->query("SELECT m.id, m.category, m.name, m.description, m.diet, m.price, m.available
                             FROM menu_items m WHERE m.available = 1 " . MENU_ORDER)->fetchAll();
        $menu = array_map(fn($r) => [
            'id'    => (int)$r['id'],
            'cat'   => $r['category'],
            'name'  => $r['name'],
            'desc'  => $r['description'],
            'diet'  => $r['diet'] === '' ? [] : explode(',', $r['diet']),
            'price' => (float)$r['price'],
        ], $rows);
        out(['ok' => true, 'menu' => $menu]);

    // ---------- Public: place an order ----------
    case 'create':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST required', 405);

        $name = trim((string)($in['name'] ?? ''));
        $ref  = trim((string)($in['ref'] ?? ''));
        $type = (string)($in['type'] ?? '');
        if ($name === '' || $ref === '')              fail('Please enter your name and table / contact number.');
        if (mb_strlen($name) > 60 || mb_strlen($ref) > 60) fail('Name or reference is too long.');
        if (!in_array($type, ['Dine-in', 'Pick-up'], true)) fail('Invalid order type.');

        $items = $in['items'] ?? [];
        if (!is_array($items) || !$items || count($items) > 50) fail('Your cart is empty.');
        $qtys = [];
        foreach ($items as $it) {
            $id = (int)($it['id'] ?? 0);
            $q  = (int)($it['qty'] ?? 0);
            if ($id < 1 || $q < 1 || $q > 50) fail('Invalid item in cart.');
            $qtys[$id] = ($qtys[$id] ?? 0) + $q;
        }

        // Prices always come from the database, never from the browser.
        $ids = array_keys($qtys);
        $ph  = implode(',', array_fill(0, count($ids), '?'));
        $st  = $pdo->prepare("SELECT id, name, price FROM menu_items WHERE available = 1 AND id IN ($ph)");
        $st->execute($ids);
        $menu = [];
        foreach ($st as $m) $menu[(int)$m['id']] = $m;
        if (count($menu) !== count($ids)) fail('An item in your cart is no longer available.');

        $total = 0;
        foreach ($qtys as $id => $q) $total += $menu[$id]['price'] * $q;

        $pdo->beginTransaction();
        $pdo->prepare("INSERT INTO orders (customer_name, order_type, ref, total, created_at)
                       VALUES (?,?,?,?,?)")
            ->execute([$name, $type, $ref, $total, date('Y-m-d H:i:s')]);
        $orderId = (int)$pdo->lastInsertId();
        $pdo->prepare("UPDATE orders SET order_no = ? WHERE id = ?")
            ->execute([sprintf('PP-%04d', $orderId), $orderId]);

        $ins = $pdo->prepare("INSERT INTO order_items (order_id, item_name, qty, unit_price, subtotal)
                              VALUES (?,?,?,?,?)");
        foreach ($qtys as $id => $q) {
            $p = $menu[$id]['price'];
            $ins->execute([$orderId, $menu[$id]['name'], $q, $p, $p * $q]);
        }
        $pdo->commit();

        $row = $pdo->prepare("SELECT * FROM orders WHERE id = ?");
        $row->execute([$orderId]);
        out(['ok' => true, 'order' => formatOrders($pdo, $row->fetchAll())[0]]);

    // ---------- Admin: list orders (oldest first; admin.js reverses) ----------
    case 'list':
        requireAdmin();
        $rows = $pdo->query("SELECT * FROM (SELECT * FROM orders ORDER BY id DESC LIMIT 300) t
                             ORDER BY id ASC")->fetchAll();
        out(['ok' => true, 'orders' => formatOrders($pdo, $rows)]);

    // ---------- Admin: change status ----------
    case 'status':
        requireAdmin();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST required', 405);
        $no     = (string)($in['no'] ?? '');
        $status = (string)($in['status'] ?? '');
        $st = $pdo->prepare("SELECT id, status FROM orders WHERE order_no = ?");
        $st->execute([$no]);
        $o = $st->fetch();
        if (!$o) fail('Order not found', 404);
        if (!in_array($status, NEXT[$o['status']], true)) fail("Can't change {$o['status']} to $status");
        $pdo->prepare("UPDATE orders SET status = ? WHERE id = ?")->execute([$status, $o['id']]);
        out(['ok' => true]);

    // ---------- Public: order progress (status only) ----------
    case 'track':
        $nos = $in['nos'] ?? [];
        if (!is_array($nos)) fail('Invalid request.');
        $nos = array_values(array_unique(array_filter(array_map('strval', $nos), fn($n) => preg_match('/^PP-\d{4,}$/', $n))));
        $nos = array_slice($nos, 0, 50);
        if (!$nos) out(['ok' => true, 'status' => (object)[]]);
        $ph = implode(',', array_fill(0, count($nos), '?'));
        $st = $pdo->prepare("SELECT order_no, status FROM orders WHERE order_no IN ($ph)");
        $st->execute($nos);
        $map = [];
        foreach ($st as $r) $map[$r['order_no']] = $r['status'];
        out(['ok' => true, 'status' => (object)$map]);

    // ---------- Admin: all menu items (including hidden) ----------
    case 'menu_all':
        requireAdmin();
        $rows = $pdo->query("SELECT m.id, m.category, m.name, m.description, m.diet, m.price, m.available
                             FROM menu_items m " . MENU_ORDER)->fetchAll();
        out(['ok' => true, 'menu' => array_map('menuRow', $rows)]);

    // ---------- Admin: add or edit a menu item ----------
    case 'menu_save':
        requireAdmin();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST required', 405);
        $id    = (int)($in['id'] ?? 0);
        $cat   = trim((string)($in['cat'] ?? ''));
        $name  = trim((string)($in['name'] ?? ''));
        $desc  = trim((string)($in['desc'] ?? ''));
        $price = $in['price'] ?? null;
        $avail = !empty($in['available']) ? 1 : 0;
        $diet  = array_values(array_intersect(['V', 'GF'], is_array($in['diet'] ?? null) ? $in['diet'] : []));
        if ($cat === '' || $name === '') fail('Name and category are required.');
        if (mb_strlen($cat) > 60 || mb_strlen($name) > 80 || mb_strlen($desc) > 255) fail('Text is too long.');
        if (!is_numeric($price) || $price < 0 || $price > 100000) fail('Enter a valid price.');
        $dietStr = implode(',', $diet);

        if ($id > 0) {
            $chk = $pdo->prepare("SELECT id FROM menu_items WHERE id = ?");
            $chk->execute([$id]);
            if (!$chk->fetch()) fail('Menu item not found', 404);
            $pdo->prepare("UPDATE menu_items SET category=?, name=?, description=?, diet=?, price=?, available=? WHERE id=?")
                ->execute([$cat, $name, $desc, $dietStr, $price, $avail, $id]);
        } else {
            $next = 1 + (int)$pdo->query("SELECT COALESCE(MAX(sort_order), 0) FROM menu_items")->fetchColumn();
            $pdo->prepare("INSERT INTO menu_items (category, name, description, diet, price, available, sort_order)
                           VALUES (?,?,?,?,?,?,?)")
                ->execute([$cat, $name, $desc, $dietStr, $price, $avail, $next]);
            $id = (int)$pdo->lastInsertId();
        }
        $row = $pdo->prepare("SELECT id, category, name, description, diet, price, available FROM menu_items WHERE id = ?");
        $row->execute([$id]);
        out(['ok' => true, 'item' => menuRow($row->fetch())]);

    // ---------- Admin: delete a menu item (past orders keep their copied names/prices) ----------
    case 'menu_delete':
        requireAdmin();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST required', 405);
        $id = (int)($in['id'] ?? 0);
        if ($id < 1) fail('Invalid item.');
        $pdo->prepare("DELETE FROM menu_items WHERE id = ?")->execute([$id]);
        out(['ok' => true]);

    default:
        fail('Unknown action', 404);
    }
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    fail('Server error: ' . $e->getMessage(), 500);
}
