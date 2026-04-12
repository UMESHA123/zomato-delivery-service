import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

export const config = {
  port: process.env.DELIVERY_SERVICE_PORT || 8084,
  mongo: {
    uri: `mongodb://${process.env.MONGO_USER || 'zomato'}:${process.env.MONGO_PASSWORD || 'zomato_secret'}@${process.env.MONGO_HOST || 'localhost'}:${process.env.MONGO_PORT || '27017'}/zomato_delivery?authSource=admin`,
  },
  rabbitmq: {
    url: `amqp://${process.env.RABBITMQ_USER || 'zomato'}:${process.env.RABBITMQ_PASSWORD || 'zomato_secret'}@${process.env.RABBITMQ_HOST || 'localhost'}:${process.env.RABBITMQ_PORT || '5672'}`,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || 'zomato_secret',
  },
};
