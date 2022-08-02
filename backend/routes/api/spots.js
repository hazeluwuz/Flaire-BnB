const { check } = require("express-validator");
const {
  validateReviewData,
  validateSpotData,
  validateImageData,
  validateQueryParams,
} = require("../../utils/validation");

const { requireAuth, verifyOwner } = require("../../utils/auth");
const {
  Booking,
  Spot,
  User,
  Image,
  Review,
  sequelize,
} = require("../../db/models");
const { Op, where } = require("sequelize");
const express = require("express");
const e = require("express");
const router = express.Router();

const spotFound = function (spot, next) {
  if (!spot) {
    const err = new Error("Spot couldn't be found");
    err.message = "Spot couldn't be found";
    err.status = 404;
    next(err);
    return err;
  } else {
    return true;
  }
};

router.get("/", validateQueryParams, async (req, res, next) => {
  let query = {
    where: {},
    include: {
      model: Review,
      attributes: [],
    },
  };
  const page = req.query.page === undefined ? 0 : parseInt(req.query.page);
  const size = req.query.size === undefined ? 20 : parseInt(req.query.size);
  if (page >= 1 && size >= 1) {
    query.limit = size;
    query.offset = size * (page - 1);
  }
  // need to add avgReview and previewImage once implemented
  const spots = await Spot.findAll(query);
  res.json(spots);
});
router.get("/current", requireAuth, async (req, res, next) => {
  const { user } = req;
  const userId = user.dataValues.id;
  // need to add avgRating and previewImage once implemented
  const spots = await Spot.findAll({
    where: {
      ownerId: userId,
    },
  });
  res.json({ Spots: spots });
});

router.get("/:spotId", async (req, res, next) => {
  // must add numReviews, and avgStarRating once implemented.
  const spot = await Spot.findByPk(req.params.spotId, {
    attributes: {
      include: [
        [sequelize.fn("COUNT", sequelize.col("Reviews.id")), "numReviews"],
        [sequelize.fn("AVG", sequelize.col("Reviews.stars")), "avgStarRating"],
      ],
    },
    include: [
      {
        model: Image,
        attributes: ["id", "url"],
        group: "id",
      },
      {
        model: User,
        as: "Owner",
        attributes: ["id", "firstName", "lastName"],
      },
      {
        model: Review,
        attributes: [],
      },
    ],
    group: "Spot.id",
  });
  if (spotFound(spot, next)) {
    res.json(spot);
  }
});

router.get("/:spotId/reviews", async (req, res, next) => {
  const spot = await Spot.findByPk(req.params.spotId);
  if (spotFound(spot, next)) {
    const reviews = await spot.getReviews({
      include: [
        { model: User, attributes: ["id", "firstName", "lastName"] },
        { model: Image.scope("reviews") },
      ],
    });
    res.json({ Reviews: reviews });
  }
});

router.put(
  "/:spotId",
  requireAuth,
  validateSpotData,
  async (req, res, next) => {
    const spot = await Spot.findByPk(req.params.spotId);
    // Check if we found the spot and that the current user is the spot owner
    if (spotFound(spot, next) && verifyOwner(req.user, spot, next)) {
      spot.set(req.body);
      await spot.save();
      res.json(spot);
    }
  }
);

router.delete("/:spotId", requireAuth, async (req, res, next) => {
  const spot = await Spot.findByPk(req.params.spotId);
  // Check if we found the spot and that the current user is the spot owner
  if (spotFound(spot, next) && verifyOwner(req.user, spot, next)) {
    await spot.destroy();
    res.json({
      message: "Successfully deleted",
      statusCode: 200,
    });
  }
});
router.post("/", requireAuth, validateSpotData, async (req, res, next) => {
  const id = req.user.id;
  const spotData = Object.assign({ ownerId: id }, req.body);
  const newSpot = await Spot.create(spotData);
  res.json(newSpot);
});

router.post(
  "/:spotId/reviews",
  requireAuth,
  validateReviewData,
  async (req, res, next) => {
    const spot = await Spot.findByPk(req.params.spotId);
    if (spotFound(spot, next)) {
      const template = {
        userId: req.user.id,
        spotId: spot.id,
      };
      const reviewData = Object.assign(template, req.body);
      const newReview = await Review.create(reviewData).catch((e) => {
        res.status(403);
        res.json({
          message: "User already has a review for this spot",
          statusCode: 403,
        });
      });
      res.json(newReview);
    }
  }
);

router.post(
  "/:spotId/images",
  requireAuth,
  validateImageData,
  async (req, res, next) => {
    const spot = await Spot.findByPk(req.params.spotId);
    const { url } = req.body;

    if (spotFound(spot, next) && verifyOwner(req.user, spot, next)) {
      const images = await spot.getImages();
      if (images.length >= 10) {
        const err = new Error(
          "Maximum number of images for this resource was reached"
        );
        err.message = "Maximum number of images for this resource was reached";
        err.status = 403;
        next(err);
      }
      const image = await spot.createImage({
        url,
        spotId: req.params.spotId,
        userId: req.user.id,
      });
      res.json({
        id: image.id,
        imageableId: image.spotId,
        url: image.url,
      });
    }
  }
);

router.post("/:spotId/bookings", requireAuth, async (req, res, next) => {
  const spot = await Spot.findByPk(req.params.spotId);
  if (spotFound(spot, next) && spot.ownerId !== req.user.id) {
    const { startDate, endDate } = req.body;
    const currentSpotBookings = await Booking.findAll({
      where: {
        spotId: req.params.spotId,
        [Op.and]: [
          {
            startDate: {
              [Op.lte]: endDate,
            },
          },
          {
            endDate: {
              [Op.gte]: startDate,
            },
          },
        ],
      },
    });

    if (currentSpotBookings.length) {
      const err = new Error(
        "Sorry, this spot is already booked for the specified dates"
      );
      err.status = 403;
      err.message =
        "Sorry, this spot is already booked for the specified dates";
      err.errors = {
        startDate: "Start date conflicts with an existing booking",
        endDate: "End date conflicts with an existing booking",
      };
      return next(err);
    }

    const booking = await spot.createBooking({
      spotId: req.params.spotId,
      userId: req.user.id,
      startDate,
      endDate,
    });
    res.json({
      id: booking.id,
      spotId: booking.spotId,
      userId: booking.userId,
      startDate: booking.startDate,
      endDate: booking.endDate,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    });
  }
  if (spot.ownerId === req.user.id) {
    const err = new Error("Forbidden");
    err.message = "Forbidden";
    err.status = 403;
    next(err);
  }
});

router.get("/:spotId/bookings", requireAuth, async (req, res, next) => {
  const spot = await Spot.findByPk(req.params.spotId);
  const ownerExpected = {
    User: {
      id: "",
      firstName: "",
      lastName: "",
    },
    id: "",
    spotId: "",
    userId: "",
    startDate: "",
    endDate: "",
    createdAt: "",
    updatedAt: "",
  };
  if (spotFound(spot, next) && spot.ownerId === req.user.id) {
    const bookings = await spot.getBookings({
      include: {
        model: User,
      },
    });
    const test = bookings.map((booking) =>
      Object.assign(ownerExpected, booking.toJSON())
    );
    res.json({ Bookings: test });
  } else if (spotFound(spot, next) && spot.ownerId !== req.user.id) {
    const bookings = await spot.getBookings({
      attributes: ["spotId", "startDate", "endDate"],
    });
    res.json({ Bookings: bookings });
  }
});

module.exports = router;
