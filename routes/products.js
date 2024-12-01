// Express promise router
const Router = require("express-promise-router");
// Node-postgres (pg)
const db = require("../db/index");
// JWT
const jwt = require("../utils/jwt");
// HttpError
const HttpError = require("../utils/HttpError");
// Joi
const Joi = require("joi");

const productsRouter = new Router();

// Provides the products with a specific category (/products?category={categoryId})
productsRouter.get("/", async (req, res, next) => {
  // Specify joi schema
  const schema = Joi.object({
    category_id: Joi.number().required(),
  });

  // Validate the input
  const { value, error } = schema.validate({ category_id: req.query.category });

  // Throw an error if the category ID is blank
  if (error) {
    throw new HttpError("Invalid category ID", 404);
  }

  // These two variables will be used in our queries
  let query;
  let queryResponse;

  // Query: Get the product details
  query = `
  SELECT c.*, p.*
  FROM products.products AS p
  JOIN products.categories AS c
    ON c.category_id = $1
  LIMIT 25
  `;
  // Response
  queryResponse = await db.query(query, [value.category_id]);

  // Return the products
  res.status(200).json(queryResponse.rows);
});

// Adds a product to the database
productsRouter.post(
  "/",
  jwt.authenticateToken,
  checkUserAuthorization,
  async (req, res, next) => {
    // Get the role_id from the JWT
    const { user_id } = req.user;

    // Specify joi schema
    const schema = Joi.object({
      name: Joi.string().required(),
      description: Joi.string().required(),
      price: Joi.number().required(),
      stock_quantity: Joi.number().required(),
      category_id: Joi.number().required(),
    });

    // Validate the input
    const { value, error } = schema.validate(req.body);

    // Throw an error if there's an error
    if (error) {
      throw new HttpError("Missing required data", 400);
    }

    // These two variables will be used in our queries
    let query;
    let queryResponse;

    // Query: Check all categories
    query = `SELECT * FROM products.categories`;
    // Response
    queryResponse = await db.query(query);

    // Validate if the category from the input
    const filteredArray = queryResponse.rows.filter((row) => {
      return row.category_id === value.category_id;
    });

    // Throw an error if the given category ID is not found
    if (filteredArray.length === 0) {
      throw new HttpError("Invalid category ID", 400);
    }

    // Establish a new connection to the database since we are going to make a transaction
    const client = await db.getClient();

    try {
      // Begin transaction
      await client.query("BEGIN");

      // Query: Check all categories
      query = `
      INSERT INTO products.products(seller_id, category_id, name, description, price, stock_quantity)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `;
      // Response
      queryResponse = await client.query(query, [
        user_id,
        value.category_id,
        value.name,
        value.description,
        value.price,
        value.stock_quantity,
      ]);

      // Commit the transaction if all queries we successful
      await client.query("COMMIT");
    } catch (err) {
      // Rollback the transaction if a query was unsuccessful
      await client.query("ROLLBACK");

      // Throw an error since the transaction was unsuccessful
      console.error(`Transaction error: ${err.message}`);
      err.message = "Invalid request";
      err.statusCode = 400;
      throw err;
    } finally {
      // Release the connection after doing the transaction
      client.release();
    }

    // Return the newly created product
    res.status(201).json(queryResponse.rows[0]);
  }
);

// Provides the details of a specific product
productsRouter.get("/:productId", async (req, res, next) => {
  // Specify joi schema
  const schema = Joi.object({
    product_id: Joi.string().uuid().required(),
  });

  // Validate the input
  const { value, error } = schema.validate({
    product_id: req.params.productId,
  });

  // Throw an error if there's an error
  if (error) {
    throw new HttpError("Invalid product ID", 404);
  }

  // These two variables will be used in our queries
  let query;
  let queryResponse;

  // Query: Check all categories
  query = `
  SELECT * FROM products.products
  WHERE product_id = $1`;
  // Response
  queryResponse = await db.query(query, [value.product_id]);

  // Throw an error if the product is not found
  if (queryResponse.rows.length === 0) {
    throw new HttpError("Product not found", 404);
  }

  // Return the products
  res.status(200).json(queryResponse.rows);
});

// Updates the details of a specific product
productsRouter.put(
  "/:productId",
  jwt.authenticateToken,
  checkUserAuthorization,
  validateSellerProduct,
  async (req, res, next) => {
    // Specify joi schema
    const schema = Joi.object({
      name: Joi.string(),
      description: Joi.string(),
      price: Joi.number(),
      stock_quantity: Joi.number(),
      category_id: Joi.number(),
    });

    // Validate the input
    const { value, error } = schema.validate(req.body);

    // Throw an error if there's an error
    if (error) {
      throw new HttpError("Missing required data", 400);
    }

    if (Object.keys(value).length === 0) {
      throw new HttpError("Please provide details to update", 400);
    }

    // Establish a new connection to the database since we are going to make a transaction
    const client = await db.getClient();

    try {
      // Begin transaction
      await client.query("BEGIN");

      // Construct the set clause
      const setClause = Object.keys(value).map(
        (key, index) => `${key} = $${index + 1}`
      );

      // Query: Update the product details
      query = `
        UPDATE products.products
        SET ${setClause.join(", ")}, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = $${Object.keys(value).length + 1}
        RETURNING *
        `;
      // Response
      queryResponse = await client.query(query, [
        ...Object.values(value),
        req.params.productId,
      ]);

      // Commit the transaction if all queries we successful
      await client.query("COMMIT");
    } catch (err) {
      // Rollback the transaction if a query was unsuccessful
      await client.query("ROLLBACK");

      // Throw an error since the transaction was unsuccessful
      console.error(`Transaction error: ${err.message}`);
      err.message = "Invalid request";
      err.statusCode = 400;
      throw err;
    } finally {
      // Release the connection after doing the transaction
      client.release();
    }

    // Return the updated product
    res.status(200).json(queryResponse.rows[0]);
  }
);

// Deletes a product with the specified product ID
productsRouter.delete(
  "/:productId",
  jwt.authenticateToken,
  checkUserAuthorization,
  validateSellerProduct,
  async (req, res, next) => {
    // Establish a new connection to the database since we are going to make a transaction
    const client = await db.getClient();

    try {
      // Begin transaction
      await client.query("BEGIN");

      // These two variables will be used in our queries
      let query;
      let queryResponse;

      // Query: Delete the product
      query = `
      DELETE FROM products.products
      WHERE product_id = $1
      `;
      // Response
      queryResponse = await db.query(query, [req.params.productId]);

      // Commit the transaction if all queries we successful
      await client.query("COMMIT");
    } catch (err) {
      // Rollback the transaction if a query was unsuccessful
      await client.query("ROLLBACK");

      // Throw an error since the transaction was unsuccessful
      console.error(`Transaction error: ${err.message}`);
      err.message = "Invalid request";
      err.statusCode = 400;
      throw err;
    } finally {
      // Release the connection after doing the transaction
      client.release();
    }

    // Send a 200 status response if the transaction was successful
    res
      .status(200)
      .send({ success: true, message: "Product successfully deleted" });
  }
);

// Checks if the user is a seller or an admin
function checkUserAuthorization(req, res, next) {
  // Get the role_id from the JWT
  const { role_name } = req.user;

  // Throw an error if the user is not a seller
  if (role_name !== "Seller" && role_name !== "Admin") {
    throw new HttpError("Unauthorized", 401);
  }

  // Move to the next middleware
  next();
}

// Checks if the user is the seller of the product
async function validateSellerProduct(req, res, next) {
  // Get the user_id from the JWT
  const { user_id } = req.user;

  // These two variables will be used in our queries
  let query;
  let queryResponse;

  // Query: Get the product details
  query = `
  SELECT * 
  FROM products.products AS p
  WHERE p.product_id = $1
  `;
  // Response
  queryResponse = await db.query(query, [req.params.productId]);

  // Throw an error if the product is not found
  if (queryResponse.rows.length === 0) {
    throw new HttpError("Product not found", 404);
  }

  // Throw an error if the user is not a seller, or if the user is not the seller of the product
  const isSeller = queryResponse.rows[0].seller_id === user_id;
  if (!isSeller) {
    throw new HttpError("Unauthorized", 401);
  }

  // Move to the next middleware
  next();
}

module.exports = productsRouter;
