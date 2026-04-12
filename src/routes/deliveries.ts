import { Router, type Request, type Response } from 'express';
import { Delivery } from '../models/Delivery.js';
import { getRabbitMQChannel } from '../config/rabbitmq.js';

const router = Router();

// GET /api/delivery/available — unassigned deliveries for drivers
router.get('/available', async (req: Request, res: Response) => {
  try {
    const deliveries = await Delivery.find({ status: 'PENDING', driverId: null })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(deliveries);
  } catch (error) {
    console.error('Error fetching available deliveries:', error);
    res.status(500).json({ error: 'Failed to fetch available deliveries' });
  }
});

// GET /api/delivery/active — driver's current active delivery
router.get('/active', async (req: Request, res: Response) => {
  const driverId = req.headers['x-user-id'] as string;
  if (!driverId) {
    res.status(401).json({ error: 'Driver ID required' });
    return;
  }
  try {
    const delivery = await Delivery.findOne({
      driverId,
      status: { $in: ['ASSIGNED', 'PICKED_UP', 'ON_THE_WAY'] },
    }).lean();
    if (!delivery) {
      res.json(null);
      return;
    }
    res.json(delivery);
  } catch (error) {
    console.error('Error fetching active delivery:', error);
    res.status(500).json({ error: 'Failed to fetch active delivery' });
  }
});

// GET /api/delivery/history — driver's completed/cancelled deliveries
router.get('/history', async (req: Request, res: Response) => {
  const driverId = req.headers['x-user-id'] as string;
  if (!driverId) {
    res.status(401).json({ error: 'Driver ID required' });
    return;
  }
  try {
    const deliveries = await Delivery.find({
      driverId,
      status: { $in: ['DELIVERED', 'CANCELLED'] },
    })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ deliveries });
  } catch (error) {
    console.error('Error fetching delivery history:', error);
    res.status(500).json({ error: 'Failed to fetch delivery history' });
  }
});

// GET /api/delivery/stats — driver earnings and stats
router.get('/stats', async (req: Request, res: Response) => {
  const driverId = req.headers['x-user-id'] as string;
  if (!driverId) {
    res.status(401).json({ error: 'Driver ID required' });
    return;
  }
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalDeliveries, todayDeliveries, totalEarnings, todayEarnings, avgRating] =
      await Promise.all([
        Delivery.countDocuments({ driverId, status: 'DELIVERED' }),
        Delivery.countDocuments({ driverId, status: 'DELIVERED', deliveredAt: { $gte: today } }),
        Delivery.aggregate([
          { $match: { driverId, status: 'DELIVERED' } },
          { $group: { _id: null, total: { $sum: '$earning' } } },
        ]),
        Delivery.aggregate([
          { $match: { driverId, status: 'DELIVERED', deliveredAt: { $gte: today } } },
          { $group: { _id: null, total: { $sum: '$earning' } } },
        ]),
        Delivery.aggregate([
          { $match: { driverId, status: 'DELIVERED', rating: { $ne: null } } },
          { $group: { _id: null, avg: { $avg: '$rating' } } },
        ]),
      ]);

    res.json({
      totalDeliveries,
      todayDeliveries,
      totalEarnings: totalEarnings[0]?.total || 0,
      todayEarnings: todayEarnings[0]?.total || 0,
      avgRating: avgRating[0]?.avg ? Math.round(avgRating[0].avg * 10) / 10 : 0,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// POST /api/delivery/:id/accept — driver accepts a delivery
router.post('/:id/accept', async (req: Request, res: Response) => {
  const driverId = req.headers['x-user-id'] as string;
  const driverName = req.headers['x-user-name'] as string || 'Driver';
  if (!driverId) {
    res.status(401).json({ error: 'Driver ID required' });
    return;
  }
  try {
    // Check driver doesn't already have an active delivery
    const existing = await Delivery.findOne({
      driverId,
      status: { $in: ['ASSIGNED', 'PICKED_UP', 'ON_THE_WAY'] },
    });
    if (existing) {
      res.status(400).json({ error: 'You already have an active delivery' });
      return;
    }

    const delivery = await Delivery.findOneAndUpdate(
      { _id: req.params.id, status: 'PENDING', driverId: null },
      { driverId, driverName, status: 'ASSIGNED' },
      { new: true }
    );
    if (!delivery) {
      res.status(404).json({ error: 'Delivery not available' });
      return;
    }

    // Publish delivery accepted event
    const channel = getRabbitMQChannel();
    if (channel) {
      channel.publish(
        'delivery.exchange',
        'delivery.accepted',
        Buffer.from(JSON.stringify({
          deliveryId: delivery._id,
          orderId: delivery.orderId,
          driverId,
          driverName,
        })),
        { persistent: true }
      );
    }

    res.json(delivery);
  } catch (error) {
    console.error('Error accepting delivery:', error);
    res.status(500).json({ error: 'Failed to accept delivery' });
  }
});

// PUT /api/delivery/:id/status — update delivery status
router.put('/:id/status', async (req: Request, res: Response) => {
  const driverId = req.headers['x-user-id'] as string;
  if (!driverId) {
    res.status(401).json({ error: 'Driver ID required' });
    return;
  }
  const { status } = req.body;
  const validTransitions: Record<string, string[]> = {
    ASSIGNED: ['PICKED_UP', 'CANCELLED'],
    PICKED_UP: ['ON_THE_WAY', 'CANCELLED'],
    ON_THE_WAY: ['DELIVERED', 'CANCELLED'],
  };

  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId });
    if (!delivery) {
      res.status(404).json({ error: 'Delivery not found' });
      return;
    }

    const allowed = validTransitions[delivery.status];
    if (!allowed || !allowed.includes(status)) {
      res.status(400).json({ error: `Cannot transition from ${delivery.status} to ${status}` });
      return;
    }

    delivery.status = status;
    if (status === 'PICKED_UP') delivery.pickedUpAt = new Date();
    if (status === 'DELIVERED') {
      delivery.deliveredAt = new Date();
      delivery.completedAt = new Date();
    }
    if (status === 'CANCELLED') delivery.completedAt = new Date();
    await delivery.save();

    // Publish status update event
    const channel = getRabbitMQChannel();
    if (channel) {
      channel.publish(
        'delivery.exchange',
        'delivery.status',
        Buffer.from(JSON.stringify({
          deliveryId: delivery._id,
          orderId: delivery.orderId,
          status,
          driverId,
        })),
        { persistent: true }
      );
    }

    res.json(delivery);
  } catch (error) {
    console.error('Error updating delivery status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// PUT /api/delivery/:id/location — update driver location
router.put('/:id/location', async (req: Request, res: Response) => {
  const driverId = req.headers['x-user-id'] as string;
  if (!driverId) {
    res.status(401).json({ error: 'Driver ID required' });
    return;
  }
  const { lat, lng } = req.body;
  try {
    const delivery = await Delivery.findOneAndUpdate(
      { _id: req.params.id, driverId, status: { $in: ['ASSIGNED', 'PICKED_UP', 'ON_THE_WAY'] } },
      { driverLocation: { lat, lng } },
      { new: true }
    );
    if (!delivery) {
      res.status(404).json({ error: 'Active delivery not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

export default router;
