/* eslint-disable no-unused-vars */
const bcrypt = require("bcrypt");
const crypto = require('crypto');
const { z } = require("zod");
const Customer = require("../models/customer.model");
const jwt = require("jsonwebtoken");
const { sendRegisterVerificationMail } = require("../config/nodemailer");

// Define the schema
const customerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters long"),
});

async function createCustomer(req, res) {
  const validation = customerSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  const existingCustomer = await Customer.findOne({ email: req.body.email });
  if (existingCustomer) {
    return res.status(400).json({ error: "Email is already registered" });
  }

  try {
  
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 mins from now

    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const customer = new Customer({
      name: req.body.name,
      email: req.body.email,
      password: hashedPassword,
      otp,
      otpExpiry,
      isVerified: false,
    });
    await customer.save();

    await sendRegisterVerificationMail(req.body.email, otp);

    res.status(201).json({ message: "OTP sent to your email. Verify to complete registration." });
  } catch (error) {
    console.error("Error creating customer:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}


async function verifyOtp(req, res) {
  const { email, otp } = req.body;

  try {
    const customer = await Customer.findOne({ email });

    
    if (!customer || customer.isVerified) {
      return res.status(400).json({ error: "Invalid request or already verified" });
    }

    
    if (customer.otp !== otp) {
      return res.status(400).json({ error: "Invalid OTP" });
    }
    if (new Date() > customer.otpExpiry) {
      return res.status(400).json({ error: "OTP expired. Please register again." });
    }


    customer.isVerified = true;
    customer.otp = undefined;
    customer.otpExpiry = undefined;
    await customer.save();

    res.status(200).json({ message: "Registration successful!" });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}


async function loginCustomer(req, res) {
  const customerLoginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters long"),
  });


  const validation = customerLoginSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  try {
    const customer = await Customer.findOne({ email: req.body.email });
    
    if (!customer) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (!customer.isVerified) {
      return res.status(403).json({ error: "Account not verified. Please verify your email." });
    }

    const validPassword = await bcrypt.compare(req.body.password, customer.password);

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const payload = {
      sub: customer._id, 
      name: customer.name, // Optional
      role: "customer", // Optional
      email: customer.email, // Optional
    };
    
    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: "1h" } // Expires in 1 hour
    );
    
    req.session.user = { 
      id: customer._id, 
      name: customer.name,
    };

    res.cookie("authToken", token, {
      maxAge: 1000 * 60 * 60,
      httpOnly: true,               
      secure: true,                
    });
    
    return res.json({
      message: "Login successful",
      token,
      role: "customer",
      user: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
      },
    });
  } catch (error) {
    console.error("Error during login:", error);

    res.status(500).json({ error: "Internal server error" });
  }
}


async function resetPassword(req, res) {
  const customerResetPasswordSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters long"),
  });
  // Validate the request body
  const validation = customerResetPasswordSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  try {
    const customer = await Customer.findOne({ email: req.body.email });
    if (!customer) {
      return res.status(401).json({ error: "Invalid email" });
    }
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    customer.password = hashedPassword;
    await customer.save();
    res.json({ message: "Password reset successful" });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function logout(req, res){
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send("Failed to log out.");
    }
    res.send("Logged out successfully!");
  });
}

module.exports = {
  createCustomer,
  loginCustomer,
  resetPassword,
  logout,
  verifyOtp
};
