import {createGuestFlowHeaderRouter, createGuestFlowRouter} from '../middleware/guestFlowFactory';
import {driversFlow} from './driversFlow';

const router = createGuestFlowRouter(driversFlow);
router.use(createGuestFlowHeaderRouter(driversFlow));

export default router;
