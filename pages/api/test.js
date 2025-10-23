// pages/api/test.js
export default function handler(req, res) {
  console.log('Test API route hit:', req.method);
  res.status(200).json({ message: 'Test API route is working!', method: req.method });
}
