import express from 'express';
import {getHelpDoc, getHelpIndex} from '../controller/helpController';
import {asyncHandler} from '../modules/lib/asyncHandler';

const router = express.Router();

// GET /help - Help index (shows README)
router.get('/', asyncHandler(getHelpIndex));

// GET /help/:docName - Specific help document
router.get('/:docName', asyncHandler(getHelpDoc));

export default router;
