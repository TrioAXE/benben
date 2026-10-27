CREATE DATABASE IF NOT EXISTS pizza_press
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pizza_press;

CREATE TABLE IF NOT EXISTS menu_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  category    VARCHAR(60)  NOT NULL,
  name        VARCHAR(80)  NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  diet        VARCHAR(20)  NOT NULL DEFAULT '',      -- e.g. "V,GF"
  price       DECIMAL(10,2) NOT NULL,
  available   TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order  INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  order_no      VARCHAR(20) NULL UNIQUE,              -- PP-0001 (set after insert)
  customer_name VARCHAR(60) NOT NULL,
  order_type    ENUM('Dine-in','Pick-up') NOT NULL,
  ref           VARCHAR(60) NOT NULL,                 -- table / contact number
  status        ENUM('New','Preparing','Ready','Completed','Cancelled') NOT NULL DEFAULT 'New',
  total         DECIMAL(10,2) NOT NULL,
  created_at    DATETIME NOT NULL,
  INDEX (status),
  INDEX (created_at)
);

CREATE TABLE IF NOT EXISTS order_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT NOT NULL,
  item_name  VARCHAR(80) NOT NULL,                    -- name/price saved as they were at order time
  qty        INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  subtotal   DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

INSERT INTO menu_items (id, category, name, description, diet, price, sort_order) VALUES
 (1,'Handcrafted Pizzas','Margherita','San Marzano, Mozzarella, Basil','V',450,1),
 (2,'Handcrafted Pizzas','Pepperoni Plus','Double Pepperoni, Aged Provolone','',520,2),
 (3,'Handcrafted Pizzas','Veggie Garden','Spinach, Bell Peppers, Mushrooms, Olives','V,GF',480,3),
 (4,'Handcrafted Pizzas','Pizza Pix','Spinach, Marzano, Mozzarella, Basil','V',460,4),
 (5,'Artisanal Café Drinks','Latte','Espresso with steamed milk','',160,5),
 (6,'Artisanal Café Drinks','Americano','Espresso with hot water','',140,6),
 (7,'Artisanal Café Drinks','Iced Tea','Freshly brewed, served cold','',130,7),
 (8,'Sides & Desserts','Garlic Knots','Baked with garlic butter','',180,8),
 (9,'Sides & Desserts','Panna Cotta','Silky Italian cream dessert','',250,9);
