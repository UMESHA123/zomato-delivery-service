import mongoose, { Schema, type Document } from 'mongoose';

export interface IDelivery extends Document {
  orderId: string;
  orderNumber: string;
  restaurantName: string;
  restaurantAddress: string;
  restaurantLocation: { lat: number; lng: number };
  customerName: string;
  customerAddress: string;
  customerLocation: { lat: number; lng: number };
  driverId: string | null;
  driverName: string | null;
  driverLocation: { lat: number; lng: number } | null;
  items: { name: string; quantity: number }[];
  total: number;
  earning: number;
  distance: string;
  estimatedTime: string;
  status: string;
  createdAt: Date;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  rating: number | null;
  feedback: string | null;
}

const deliverySchema = new Schema<IDelivery>(
  {
    orderId: { type: String, required: true, index: true },
    orderNumber: { type: String, default: '' },
    restaurantName: { type: String, required: true },
    restaurantAddress: { type: String, default: '' },
    restaurantLocation: {
      lat: { type: Number, default: 0 },
      lng: { type: Number, default: 0 },
    },
    customerName: { type: String, required: true },
    customerAddress: { type: String, default: '' },
    customerLocation: {
      lat: { type: Number, default: 0 },
      lng: { type: Number, default: 0 },
    },
    driverId: { type: String, default: null, index: true },
    driverName: { type: String, default: null },
    driverLocation: {
      type: { lat: Number, lng: Number },
      default: null,
    },
    items: [{ name: String, quantity: Number }],
    total: { type: Number, default: 0 },
    earning: { type: Number, default: 0 },
    distance: { type: String, default: 'N/A' },
    estimatedTime: { type: String, default: '30-35 min' },
    status: {
      type: String,
      enum: ['PENDING', 'ASSIGNED', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    pickedUpAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    rating: { type: Number, default: null },
    feedback: { type: String, default: null },
  },
  { timestamps: true }
);

// Compound index for driver history queries
deliverySchema.index({ driverId: 1, status: 1, createdAt: -1 });

export const Delivery = mongoose.model<IDelivery>('Delivery', deliverySchema);
