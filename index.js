const express = require("express");
const cors = require("cors");
require("dotenv").config();
const Jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.SECRET_REACT_KEY);
const port = process.env.PORT || 5000;
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
//Middle War
app.use(cors());
app.use(express.json());
const uri = process.env.DB_USER_URL;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});
function JwtVerify(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("UnAuthorized Access");
  }
  const token = authHeader.split(" ")[1];
  Jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      return res.send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
    next();
  });
}
async function runDB() {
  try {
    const appointmentOptions = client
      .db("doctorsLab")
      .collection("appointmentOptions");
    const bookingsCollection = client.db("doctorsLab").collection("bookings");
    const userCollection = client.db("doctorsLab").collection("users");
    const doctorsCollection = client.db("doctorsLab").collection("doctors");
    client.connect();
    console.log("Databse Connected");
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await userCollection.findOne(query);
      if (user?.role !== "admin") {
        return res.send("Fobidden Access");
      }
      next();
    };
    // Booking Slot and get Date//
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appointmentOptions.find(query).toArray();
      const alreadyBooked = await bookingsCollection
        .find({ appointmentDate: date })
        .toArray();
      options.forEach((option) => {
        const optionName = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        const alreadyBookedSlot = optionName.map((book) => book.slot);
        const bookingSlot = option.slots.filter(
          (slot) => !alreadyBookedSlot.includes(slot)
        );
        option.slots = bookingSlot;
      });
      res.send(options);
    });
    app.get("/appointmentSpecialty", async (req, res) => {
      const result = await appointmentOptions
        .find({})
        .project({ name: 1 })
        .toArray();
      res.send(result);
    });
    app.post("/addDoctor", JwtVerify, verifyAdmin, async (req, res) => {
      const result = await doctorsCollection.insertOne(req.body);
      res.send(result);
    });
    app.get("/doctors", JwtVerify, verifyAdmin, async (req, res) => {
      const result = await doctorsCollection.find({}).toArray();
      res.send(result);
    });
    app.delete("/doctors/:id", JwtVerify, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await doctorsCollection.deleteOne({ _id: ObjectId(id) });
      res.send(result);
    });
    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user) {
        const token = Jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "1h",
        });
        return res.send({ success: token });
      }
      res.send({ failed: "UnAuthorized Access" });
    });
    app.put('/updateStatus/:id',async(req,res)=>{
      const {id} = req.params
      const status = req.body.status
      const updateStatus = {
        $set: {
          status: status,
        },
      };
      const result = await bookingsCollection.updateOne(
        { _id: ObjectId(id) },
        updateStatus
      );
      res.send(result);
    })
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      // When i get same data from database, i prevent this function
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
    }
      const alreadyBooked = await bookingsCollection.find(query).toArray();
      
      if (alreadyBooked.length) {
        return res.send({
          success: false,
          message: `Already Booked `,
        });
      }
      const result = await bookingsCollection.insertOne(booking);
      if (result.insertedId) {
        res.send({
          success: true,
        });
      }
    });
    app.post("/users", async (req, res) => {
      const query = req.body;
      const result = await userCollection.insertOne(query);
      res.send(result);
    });
    app.delete("/users/:id", JwtVerify, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await userCollection.deleteOne({ _id: ObjectId(id) });
      res.send(result);
    });
    app.get("/users", async (req, res) => {
      const query = {};
      const result = await userCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/bookings", JwtVerify, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: "Unauthorized Access" });
      }
      const query = { email: email };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const result = await bookingsCollection.findOne({ _id: ObjectId(id) });
      res.send(result);
    });
    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });
    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const { price } = booking;
      const amount = parseFloat(price) * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        currency: "usd",
        amount: amount,
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
    app.put("/users/admin/:id", JwtVerify, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      if (result.modifiedCount) {
        res.send({
          success: true,
          message: "Make Admin Successfully",
        });
      }
    });
  } finally {
  }
}
runDB().catch((err) => console.log(err));
app.get("/", (req, res) => {
  res.send("Doctors Lab Server is running");
});
app.listen(port, () => console.log(`Doctors lab is running on ${port}`));
