const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const authMiddleware = require('../middlewares/authMiddleware');
const upload = require('../utils/upload');

const optionalAuth = require('../middlewares/optionalAuthMiddleware');

router.get('/', optionalAuth, postController.getPosts);

router.get('/my/published', authMiddleware, postController.getMyPublishedPosts);
router.get('/my/liked', authMiddleware, postController.getMyLikedPosts);
router.get('/my/participated', authMiddleware, postController.getMyParticipatedPosts);

router.get('/:postId', optionalAuth, postController.getPostDetail);

router.post('/', authMiddleware, upload.array('images', 9), postController.createPost);
router.post('/:postId/like', authMiddleware, postController.toggleLike);
router.post('/:postId/comment', authMiddleware, postController.addComment);

module.exports = router;
