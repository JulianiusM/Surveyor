import express, {NextFunction, Request, Response} from 'express';
import createError from 'http-errors';
import {getHelpContent, getHelpTopics} from '../modules/help/helpTopics';

const router = express.Router();

router.get('/', (_req: Request, res: Response) => {
    res.render('help/index', {topics: getHelpTopics()});
});

router.get('/:slug', (req: Request, res: Response, next: NextFunction) => {
    const content = getHelpContent(req.params.slug);

    if (!content) {
        return next(createError(404));
    }

    res.render('help/topic', {
        topics: getHelpTopics(),
        topic: content.topic,
        html: content.html,
    });
});

export default router;
