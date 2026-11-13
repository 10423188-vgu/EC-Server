import resend from "../../configs/integrations/mailer.js";

export const sendResetPasswordEmail = async (to, resetUrl) => {
  const { error } = await resend.emails.send({
    from: process.env.MAIL_FROM,
    to,
    subject: "Reset your password",
    html: `
      <p>You requested a password reset.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a></p>
      <p>This link expires in 15 minutes. If you didn't request this, you can ignore this email.</p>
    `,
  });
  if (error) throw error;
};

export const sendVerificationEmail = async (to, verifyUrl) => {
  const { error } = await resend.emails.send({
    from: process.env.MAIL_FROM,
    to,
    subject: "Verify your email",
    html: `
      <p>Thanks for signing up! Please verify your email address to unlock checkout.</p>
      <p><a href="${verifyUrl}">Click here to verify your email</a></p>
      <p>This link expires in 24 hours.</p>
    `,
  });
  if (error) throw error;
};
