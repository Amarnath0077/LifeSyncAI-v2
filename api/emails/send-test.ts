import nodemailer from "nodemailer";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { recipient } = req.body;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: recipient,
      subject: "LifeSync AI Test Email",
      html: `
        <h2>LifeSync AI</h2>
        <p>Your email integration is working successfully.</p>
      `,
    });

    return res.status(200).json({
      success: true,
      message: "Email sent successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
