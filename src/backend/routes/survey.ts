import {createGuestFlowHeaderRouter, createGuestFlowRouter} from '../middleware/guestFlowFactory';
import {surveyFlow} from './surveyFlow';

const router = createGuestFlowRouter(surveyFlow);
router.use(createGuestFlowHeaderRouter(surveyFlow));

export default router;
