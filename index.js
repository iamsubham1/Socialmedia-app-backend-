const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const uuid = require("uuid");
const mongoose = require("mongoose");
const { ObjectId } = require("mongodb");
const multer = require("multer");
const { exec } = require("child_process");
const nodemailer = require("nodemailer");
const otpGenerator = require("otp-generator");
const paypal = require("paypal-rest-sdk");
const connectToMongo = require('./db');
const port = process.env.PORT;
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const mongoURI = process.env.MONGODB_URI;
require('dotenv').config({ path: '.env' });



const startServer = async () => {

  // Serve the static files
  app.use(express.static("public"));
  app.use(cors({ origin: process.env.CLIENT_URL }));
  app.use(express.json());


  // Set up MongoDB connection
  const connectToMongo = async () => {

    try {
      await mongoose.connect(mongoURI);
      // console.log("Connected to MongoDB successfully");
    }
    catch (error) {
      console.log(error);
      process.exit();
    }
  };
  connectToMongo();

  // Create a video schema and model
  const videoSchema = new mongoose.Schema({
    author: String,
    description: String,
    videoUrl: String,
    thumbnailUrl: String,
    likes: { type: Array, default: [] },
    comments: { type: Array, default: [] },
    saved: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now },
  });

  const Video = mongoose.model("Video", videoSchema);

  const loginSchema = new mongoose.Schema({
    name: String,
    userId: String,
    fancyId: String,
    password: String,
    profilePic: { type: String, default: "" },
    interests: { type: Array, default: [] },
    tokens: { type: Number, default: 5 },
    posts: { type: Array, default: [] },
    saved: { type: Array, default: [] },
    followers: { type: Array, default: [] },
    following: { type: Array, default: [] },
    socialId: { type: String, default: "" },
    live: { type: Boolean, default: false },
  });

  const Login = mongoose.model("Login", loginSchema);

  const messageSchema = new mongoose.Schema({
    from: String,
    to: String,
    message: String,
    seen: { type: Boolean, default: false },
  });

  const Message = mongoose.model("Message", messageSchema);

  app.get('/', (req, res) => {
    res.send("hello")
  })

  //tested
  app.post("/message", async (req, res) => {
    try {
      const { from, to, message } = req.body;
      const newMessage = new Message({ from, to, message });
      await newMessage.save();
      res.status(200).json({ message: "Message sent successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error sending message" });
    }
  });

  app.post("/retriveMessage", async (req, res) => {
    try {
      const { from, to } = req.body;
      const messages = await Message.find({
        $or: [
          { from: from, to: to },
          { from: to, to: from },
        ],
      });
      await Message.updateMany(
        {
          from: to,
          to: from,
        },
        {
          seen: true,
        }
      );
      // console.log(messages);
      res.status(200).json(messages);
    } catch (error) {
      res.status(500).json({ message: "Error retriving message" });
    }
  });

  app.post("/usersAndUnseenChatsAndLastMessage", async (req, res) => {
    try {
      const { userId } = req.body;
      const pipeline = [
        {
          $match: {
            $or: [{ to: userId }, { from: userId }],
          },
        },
        {
          $sort: {
            _id: -1,
          },
        },
        {
          $group: {
            _id: {
              $cond: [{ $eq: ["$from", userId] }, "$to", "$from"],
            },
            unseenCount: {
              $sum: {
                $cond: [{ $eq: ["$to", userId] }, { $cond: ["$seen", 0, 1] }, 0],
              },
            },
            lastMessage: {
              $first: "$message",
            },
          },
        },
      ];

      const chattedUsers = await Message.aggregate(pipeline);

      // Get an array of unique user IDs from the chattedUsers result
      const userIds = chattedUsers.map((user) => user._id);

      // Fetch the corresponding user details from the Login collection
      const userNames = await Login.find({ _id: { $in: userIds } }, "name");

      // Create a map of userId to userName for faster lookup
      const userNameMap = new Map();
      userNames.forEach((user) =>
        userNameMap.set(user._id.toString(), user.name)
      );

      // Merge the userName into the chattedUsers result
      const chattedUsersWithNames = chattedUsers.map((user) => {
        const person = Login.findOne({ _id: user._id });
        return {
          _id: user._id,
          name: userNameMap.get(user._id.toString()) || "Deleted User",
          profilePic: person.profilePic,
          unseenCount: user.unseenCount,
          lastMessage: user.lastMessage,
        };
      });

      // console.log(chattedUsersWithNames);
      res.status(200).json(chattedUsersWithNames);
    } catch (error) {
      res.status(500).json({ message: "Error retriving Last chat & info" });
    }
  });

  app.post("/getPostsAndSaved", async (req, res) => {
    try {
      const { userId, reqId } = req.body;
      const Info = await Login.findOne({ _id: userId });
      const posts = Info.posts;
      const saved = Info.saved;
      const followers = Info.followers;
      const following = Info.following;

      const postsInfo = await Promise.all(
        posts.map(async (post) => {
          const video = await Video.findById(post);
          return video;
        })
      );

      const savedInfo = await Promise.all(
        saved.map(async (save) => {
          const video = await Video.findById(save);
          return video;
        })
      );

      const followersInfo = await Promise.all(
        followers.map(async (follower) => {
          const user = await Login.findById(follower);
          return {
            followerId: follower,
            followerName: user.fancyId,
            followerPic: user.profilePic,
            following: user.followers.includes(reqId),
          };
        })
      );

      const followingInfo = await Promise.all(
        following.map(async (follow) => {
          const user = await Login.findById(follow);
          return {
            followingId: follow,
            followingName: user.fancyId,
            followingPic: user.profilePic,
            following: user.followers.includes(reqId),
          };
        })
      );

      res.status(200).json({ postsInfo, savedInfo, followersInfo, followingInfo });
    } catch (error) {
      res.status(500).json({ message: "Error retriving Last chat & info" });
    }
  });

  app.post("/login", async (req, res) => {
    try {
      const { userId, password } = req.body;

      // Find a document where userId and password match
      const login = await Login.findOne({ userId, password });

      if (login) {
        res.status(200).json(login);
      } else {
        res.status(404).json({ message: "Login not found" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error retrieving login" });
    }
  });

  app.post("/getTokens", async (req, res) => {
    try {
      const { _id } = req.body;
      const getToken = await Login.findOne({ _id });
      if (getToken) {
        res.status(200).json(getToken["tokens"]);
      } else {
        res.status(404).json({ message: "Tokens not found" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error retreiving Tokens" });
    }
  });

  app.post("/updateTokens", async (req, res) => {
    try {
      const { _id, tokens } = req.body;
      const updateToken = await Login.updateOne({ _id }, { $inc: { tokens } });
      if (updateToken) {
        res.status(200).json({ message: "Tokens updated successfully" });
      } else {
        res.status(404).json({ message: "Tokens not updated" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error updating Tokens" });
    }
  });

  app.post("/storeInterests", async (req, res) => {
    try {
      const { _id, interests } = req.body;
      const addInterests = await Login.updateOne({ _id }, { interests });
      if (addInterests) {
        res.status(200).json({ message: "Interests updated successfully" });
      } else {
        res.status(404).json({ message: "Interests not updated" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error updating Interests" });
    }
  });

  app.post("/getInterests", async (req, res) => {
    try {
      const { _id } = req.body;
      const getInterests = await Login.findOne({ _id });
      if (getInterests) {
        res.status(200).json(getInterests["interests"]);
      } else {
        res.status(404).json({ message: "Interests not found" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error retreiving Interests" });
    }
  });

  app.post("/signup", async (req, res) => {
    try {
      const { name, userId, password } = req.body;

      // Check if the user already exists
      const existingUser = await Login.findOne({ userId });

      if (existingUser) {
        res.status(409).json({ message: "User already exists" });
      } else {
        // Create a new user
        const fancyId = userId.split("@")[0];
        const newUser = new Login({ name, userId, password, fancyId });

        // Save the new user to the database
        await newUser.save();

        const userData = await Login.findOne({ userId });

        res
          .status(200)
          .json({ message: "User created successfully", _id: userData["_id"] });
      }
    } catch (error) {
      res.status(500).json({ message: "Error creating user" });
    }
  });

  const upload = multer({ dest: "uploads/" });
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  // Upload endpoint to save videos
  app.post("/upload", upload.single("video"), async (req, res) => {
    try {
      const { author, description } = req.body;
      const inputUrl = req.file.path;
      const thumbnailUrl = req.file.path + "-thumbnail.jpg";
      const videoUrl = req.file.path + "-720p.mp4";

      const generateThumbnail = `ffmpeg -i ${inputUrl} -vf "thumbnail,scale=320:240" -vframes 1 ${thumbnailUrl}`;
      exec(generateThumbnail, async (error, stdout, stderr) => {
        if (error) {
          console.error(`Error generating thumbnail: ${error}`);
          res.status(500).send("Error generating thumbnail");
          return;
        }
        console.log("Thumbnail generated successfully");

        const convert = `ffmpeg -i ${inputUrl} -vf "scale=-1:720" ${videoUrl}`;
        exec(convert, async (error, stdout, stderr) => {
          if (error) {
            console.error(`Error converting video: ${error}`);
            res.status(500).send("Error converting video");
            return;
          }
          console.log("Video converted successfully");

          // Create a new video instance
          const newVideo = new Video({
            author,
            description,
            videoUrl,
            thumbnailUrl,
          });

          // Save the video to the database
          const savedVideo = await newVideo.save();

          await Login.updateOne(
            { _id: author },
            { $push: { posts: savedVideo._id } }
          );

          res.status(201).json({ message: "Video uploaded successfully" });

          fs.unlink(inputUrl, (error) => {
            if (error) {
              console.error(`Error deleting file: ${error}`);
              return;
            }
            console.log("File deleted successfully");
          });
        });
      });
    } catch (error) {
      res.status(500).json({ message: "Error uploading video" });
    }
  });

  app.post("/reels", async (req, res) => {
    try {
      const { userId } = req.body;
      // Fetch all videos from the database
      const videos = await Video.find().sort({ createdAt: -1 });

      // Prepare the response with additional information
      const reelsWithInfo = await Promise.all(
        videos.map(async (video) => {
          const authorName = await getAuthorName(video.author);
          const profilePic = await getProfilePic(video.author);
          const likedStatus = await isVideoLikedByUser(video._id, userId);
          const likesCount = video.likes.length;
          const commentsCount = video.comments.length;
          const savedStatus = await isVideoSavedByUser(video._id, userId);
          const savedByCount = video.saved.length;

          return {
            ...video.toObject(),
            authorName,
            profilePic,
            likedStatus,
            likesCount,
            commentsCount,
            savedStatus,
            savedByCount,
          };
        })
      );
      res.status(200).json(reelsWithInfo);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Helper functions to get additional information
  async function getAuthorName(authorId) {
    const login = await Login.findOne({ _id: authorId });
    return login ? login.fancyId : "Unknown";
  }

  async function getProfilePic(authorId) {
    const person = await Login.findById({ _id: authorId });
    return person ? person.profilePic : null;
  }

  async function isVideoLikedByUser(videoId, userId) {
    const video = await Video.findById(videoId);
    return video.likes.includes(userId);
  }

  async function isVideoSavedByUser(videoId, userId) {
    const video = await Video.findById(videoId);
    return video.saved.includes(userId);
  }

  app.post("/like", async (req, res) => {
    try {
      const { videoId, userId, likedStatus } = req.body;
      if (likedStatus) {
        await Video.updateOne({ _id: videoId }, { $pull: { likes: userId } });
      } else {
        await Video.updateOne({ _id: videoId }, { $push: { likes: userId } });
      }

      res.status(200).json({ message: "Video liked/disliked successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error liking/disliking video" });
    }
  });

  app.post("/save", async (req, res) => {
    try {
      const { videoId, userId, savedStatus } = req.body;
      if (savedStatus) {
        await Video.updateOne({ _id: videoId }, { $pull: { saved: userId } });
        await Login.updateOne({ _id: userId }, { $pull: { saved: videoId } });
      } else {
        await Video.updateOne({ _id: videoId }, { $push: { saved: userId } });
        await Login.updateOne({ _id: userId }, { $push: { saved: videoId } });
      }

      res.status(200).json({ message: "Video saved/unsaved successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error saving/unsaving video" });
    }
  });

  app.post("/likeComment", async (req, res) => {
    try {
      const { videoId, commentId, userId, likedStatus } = req.body;
      if (likedStatus) {
        await Video.updateOne(
          { _id: videoId, "comments._id": new ObjectId(commentId) },
          { $pull: { "comments.$.likes": userId } }
        );
      } else {
        await Video.updateOne(
          { _id: videoId, "comments._id": new ObjectId(commentId) },
          { $push: { "comments.$.likes": userId } }
        );
      }
      res.status(200).json({ message: "Comment liked/disliked successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error liking/disliking comment" });
    }
  });

  app.post("/getComments", async (req, res) => {
    try {
      const { videoId, userId } = req.body;
      const video = await Video.findById(videoId);
      const comments = video.comments;
      const commentsWithInfo = await Promise.all(
        comments.map(async (comment) => {
          const authorName = await getAuthorName(comment.author);
          const profilePic = await getProfilePic(comment.author);
          const likedStatus = await comment.likes.includes(userId);
          const likesCount = comment.likes.length;
          return {
            ...comment,
            authorName,
            profilePic,
            likedStatus,
            likesCount,
          };
        })
      );
      res.status(200).json(commentsWithInfo);
    } catch (error) {
      res.status(500).json({ message: "Error retrieving comments" });
    }
  });

  app.post("/postComment", async (req, res) => {
    try {
      const { videoId, author, comment } = req.body;
      const id = new ObjectId();
      await Video.updateOne(
        { _id: videoId },
        { $push: { comments: { _id: id, author, comment, likes: [] } } }
      );
      res.status(200).json(id);
    } catch (error) {
      res.status(500).json({ message: "Error posting comment" });
    }
  });

  function matchSockets(socket) {
    if (availableUsers.size < 2) {
      socket.emit("chatError", "Waiting for another user to join...");
      return;
    }

    const myInterests = availableUsers.get(socket.id);

    // Remove the current user from the available users map
    availableUsers.delete(socket.id);

    // Find a matching user
    const match = [...availableUsers.entries()].find(([_, interests]) => {
      return interests.some((interest) => myInterests.includes(interest));
    });

    if (!match) {
      // No user with similar interests found, recursively call matchSockets again
      matchSockets(socket);
      return;
    }

    const [otherSocketId, otherUserInterests] = match;

    // Remove the selected user from the available users map
    availableUsers.delete(otherSocketId);

    // Create a chat room or session
    const roomId = uuid.v4();

    // Store the room ID in the sockets' custom properties for later use
    socket.data.roomId = roomId;
    const otherSocket = io.sockets.sockets.get(otherSocketId);
    otherSocket.data.roomId = roomId;

    socket.join(roomId);
    otherSocket.join(roomId);

    // Notify the users about the match and the room ID
    socket.emit("chatMatched", {
      roomId: roomId,
      to: otherSocketId,
    });
  }

  // Store the active connections
  const availableUsers = new Map();

  // Handle socket.io connections
  io.on("connection", (socket) => {
    socket.emit("create", socket.id);
    console.log(`${socket.id} connected`);

    // Store the user's socket connection
    socket.on("reConnect", (interests) => {
      // console.log(interests.data);
      availableUsers.set(socket.id, interests.data);
    });

    socket.on("startChat", () => {
      matchSockets(socket);
    });

    // Handle offer signaling
    socket.on("call-user", (data) => {
      const { offer, targetSocketID } = JSON.parse(data);
      io.to(targetSocketID).emit("call-made", {
        sourceSocketID: socket.id,
        offer: offer,
      });
    });

    // Handle answer signaling
    socket.on("make-answer", (data) => {
      console.log("make-answer");
      const { answer, targetSocketID } = JSON.parse(data);
      io.to(targetSocketID).emit("answer-made", {
        sourceSocketID: socket.id,
        answer: answer,
      });
    });

    // Handle ICE candidate signaling
    socket.on("ice-candidate", (data) => {
      console.log("ice-candidate");
      const { targetSocketID, candidate } = JSON.parse(data);
      io.to(targetSocketID).emit("ice-candidate", {
        sourceSocketID: socket.id,
        candidate: candidate,
      });
    });

    socket.on("message", (data) => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("message", data);
    });

    socket.on("ask-increment", () => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("ask-increment");
    });

    socket.on("reply-increment", (data) => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("reply-increment", data);
    });

    socket.on("ask-chat", (data) => {
      const roomId = socket.data.roomId;
      const allData = JSON.parse(data);
      socket.to(roomId).emit("ask-chat", allData);
    });

    socket.on("reply-chat", (data) => {
      const roomId = socket.data.roomId;
      const allData = JSON.parse(data);
      socket.to(roomId).emit("reply-chat", allData);
    });

    socket.on("close-chat", () => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("close-chat");
    });

    socket.on("ask-exchange-numbers", () => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("ask-exchange-numbers");
    });
    socket.on("reply-exchange-numbers", (data) => {
      const roomId = socket.data.roomId;
      socket.to(roomId).emit("reply-exchange-numbers", data);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      availableUsers.delete(socket.id);
      const roomId = socket.data.roomId;
      if (roomId) {
        socket.to(roomId).emit("hangup");
        // Clean up the room data
        socket.leave(roomId);
        delete socket.data.roomId;
      }
      console.log(`${socket.id} disconnected`);
    });
  });

  // forgotPassword
  app.post("/verify-email", async (req, res) => {
    const { userId } = req.body;
    const existingUser = await Login.findOne({ userId });
    if (existingUser) {
      res.status(200).json({ message: true });
      return;
    }
    res.status(404).json({ message: false });
  });

  app.post("/change-password", async (req, res) => {
    try {
      const { userId, password } = req.body;
      const updatePassword = await Login.updateOne({ userId }, { password });
      if (updatePassword) {
        res.status(200).json({ message: "Password changed successfully" });
      } else {
        res.status(404).json({ message: "Password not changed" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error changing Password" });
    }
  });

  // Create a transporter using Gmail SMTP configuration
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.APP_PASSWORD,
    },
  });

  // Handle POST request to verify email and send OTP
  app.post("/send-email", (req, res) => {
    const { email } = req.body;

    // Generate OTP
    const otp = otpGenerator.generate(4, {
      digits: true,
      alphabets: false,
      upperCase: false,
      specialChars: false,
    });

    // Compose the email message
    const mailOptions = {
      from: `NetTeam Support <${process.env.EMAIL}>`,
      to: email,
      subject: "Email Verification",
      text: `Your OTP is: ${otp}`,
    };

    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log("Error:", error);
        res
          .status(500)
          .json({ error: "An error occurred while sending the email" });
      } else {
        console.log("Email sent:", info.response);
        res.status(200).json(otp);
      }
    });
  });
  // forgot password

  // SUPERCHAT
  // PayPal configuration
  paypal.configure({
    mode: "sandbox", // Set 'live' for production mode
    client_id: process.env.PAYPAL_CLIENT_ID,
    client_secret: process.env.PAYPAL_CLIENT_SECRET,
  });

  // Payment endpoint
  app.post("/payment", (req, res) => {
    const paymentAmount = req.body.amount; // Amount received from frontend

    const create_payment_json = {
      intent: "sale",
      payer: {
        payment_method: "paypal",
      },
      transactions: [
        {
          amount: {
            total: paymentAmount.toFixed(2),
            currency: "USD",
          },
        },
      ],
      redirect_urls: {
        return_url: process.env.PAYPAL_RETURN_URL,
        cancel_url: process.env.PAYPAL_CANCEL_URL,
      },
    };

    paypal.payment.create(create_payment_json, (error, payment) => {
      if (error) {
        res
          .status(500)
          .json({ status: "error", message: "Payment creation failed" });
      } else {
        for (let i = 0; i < payment.links.length; i++) {
          if (payment.links[i].rel === "approval_url") {
            res.json({ status: "created", approvalUrl: payment.links[i].href });
          }
        }
      }
    });
  });

  // Payment confirmation endpoint
  app.get("/payment/confirm", (req, res) => {
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;

    const execute_payment_json = {
      payer_id: payerId,
    };

    paypal.payment.execute(paymentId, execute_payment_json, (error, payment) => {
      if (error) {
        res
          .status(500)
          .json({ status: "error", message: "Payment execution failed" });
      } else {
        res.json({ status: "success", message: "Payment successful" });
      }
    });
  });
  // Supercht end

  app.post("/updateName", async (req, res) => {
    try {
      const { _id, name } = req.body;
      await Login.updateOne({ _id }, { name });
      res.status(200).json({ message: "Name updated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error updating Name" });
    }
  });

  app.post("/updateFancyId", async (req, res) => {
    try {
      const { _id, fancyId } = req.body;
      await Login.updateOne({ _id }, { fancyId });
      res.status(200).json({ message: "FancyId updated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error updating FancyId" });
    }
  });

  app.post("/updateEmail", async (req, res) => {
    try {
      const { _id, userId } = req.body;
      await Login.updateOne({ _id }, { userId });
      res.status(200).json({ message: "Email updated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error updating Email" });
    }
  });

  app.post("/updateSocial", async (req, res) => {
    try {
      const { _id, socialId } = req.body;
      await Login.updateOne({ _id }, { socialId });
      res.status(200).json({ message: "Email updated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error updating Email" });
    }
  });

  app.post("/getAllUsers", async (req, res) => {
    try {
      const { _id } = req.body;
      const users = await Login.find({ _id: { $ne: _id } });
      const updatedUsers = users.map((user) => ({
        ...user._doc,
        following: user.followers.includes(_id),
      }));
      res.status(200).json(updatedUsers);
    } catch (error) {
      res.status(500).json({ message: "Error getting all users" });
    }
  });

  app.post("/getUserProfile", async (req, res) => {
    try {
      const { _id, reqId } = req.body;
      const user = await Login.find({ _id });
      const updatedUser = {
        ...user[0]._doc,
        following: user[0].followers.includes(reqId),
      };
      res.status(200).json(updatedUser);
    } catch (error) {
      res.status(500).json({ message: "Error getting all users" });
    }
  });

  app.post("/follow", async (req, res) => {
    try {
      const { _id, reqId, followStatus } = req.body;
      if (followStatus) {
        await Login.updateOne({ _id }, { $pull: { followers: reqId } });
        await Login.updateOne({ _id: reqId }, { $pull: { following: _id } });
      } else {
        await Login.updateOne({ _id }, { $push: { followers: reqId } });
        await Login.updateOne({ _id: reqId }, { $push: { following: _id } });
      }
      res.status(200).json({ message: "Person followed/unfollowed successfully" });
    } catch (error) {
      res.status(500).json({ message: "Error followed/unfollowed Person" });
    }


  });

  app.listen(port, () => {
    console.log(`this server is running on ${port}`);

  })
};
// Start the server

const initializeApp = async () => {
  await connectToMongo();
  await startServer();
}
// Invoke the initialization function
initializeApp();
