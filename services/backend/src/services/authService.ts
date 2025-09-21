
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import db from '../db';
import { User,UserRow } from '../types/user';
import jwtUtils from '../utils/jwt';
import ejs from 'ejs';

const RESET_TTL = 1000 * 60 * 60;         // 1h
const INVITE_TTL = 1000 * 60 * 60 * 24 * 7; // 7d

// Función para sanitizar datos de entrada
function sanitizeInput(input: string): string {
  if (!input) return '';
  
  // Remover caracteres peligrosos para templates
  return input
    .replace(/<%/g, '')  // Remover inicio de tags EJS
    .replace(/%>/g, '')  // Remover fin de tags EJS
    .replace(/<%=/g, '') // Remover tags de salida EJS
    .replace(/<%-/g, '') // Remover tags de salida sin escape
    .replace(/<%#/g, '') // Remover comentarios EJS
    .replace(/<%!/g, '') // Remover comentarios EJS
    .replace(/<%/g, '')  // Remover cualquier tag EJS restante
    .replace(/<%>/g, '') // Remover cualquier tag EJS restante
    .trim()
    .substring(0, 100); // Limitar longitud
}

class AuthService {

  static async createUser(user: User) {
    // Sanitizar datos de entrada
    const sanitizedUser = {
      ...user,
      first_name: sanitizeInput(user.first_name),
      last_name: sanitizeInput(user.last_name),
      username: sanitizeInput(user.username)
    };

    const existing = await db<UserRow>('users')
      .where({ username: sanitizedUser.username })
      .orWhere({ email: sanitizedUser.email })
      .first();
    if (existing) throw new Error('User already exists with that username or email');
    
    // create invite token
    const invite_token = crypto.randomBytes(6).toString('hex');
    const invite_token_expires = new Date(Date.now() + INVITE_TTL);
    await db<UserRow>('users')
      .insert({
        username: sanitizedUser.username,
        password: sanitizedUser.password,
        email: sanitizedUser.email,
        first_name: sanitizedUser.first_name,
        last_name: sanitizedUser.last_name,
        invite_token,
        invite_token_expires,
        activated: false
      });
      // send invite email using nodemailer and local SMTP server
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    const link = `${process.env.FRONTEND_URL}/activate-user?token=${invite_token}&username=${sanitizedUser.username}`;
   
    const template = `
      <html>
        <body>
          <h1>Hello <%= firstName %> <%= lastName %></h1>
          <p>Click <a href="<%= link %>">here</a> to activate your account.</p>
        </body>
      </html>`;
    const htmlBody = ejs.render(template, {
      firstName: sanitizedUser.first_name,
      lastName: sanitizedUser.last_name,
      link: link
    }, {
      escape: true,    //
      strict: true     
    });
    
    await transporter.sendMail({
      from: "info@example.com",
      to: sanitizedUser.email,
      subject: 'Activate your account',
      html: htmlBody
    });
  }

  static async updateUser(user: User) {
    const existing = await db<UserRow>('users')
      .where({ id: user.id })
      .first();
    if (!existing) throw new Error('User not found');
    await db<UserRow>('users')
      .where({ id: user.id })
      .update({
        username: user.username,
        password: user.password,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name
      });
    return existing;
  }

  static async authenticate(username: string, password: string) {
    const user = await db<UserRow>('users')
      .where({ username })
      .andWhere('activated', true)
      .first();
    if (!user) throw new Error('Invalid email or not activated');
    if (password != user.password) throw new Error('Invalid password');
    return user;
  }

  static async sendResetPasswordEmail(email: string) {
    const user = await db<UserRow>('users')
      .where({ email })
      .andWhere('activated', true)
      .first();
    if (!user) throw new Error('No user with that email or not activated');

    const token = crypto.randomBytes(6).toString('hex');
    const expires = new Date(Date.now() + RESET_TTL);

    await db('users')
      .where({ id: user.id })
      .update({
        reset_password_token: token,
        reset_password_expires: expires
      });

    // send email with reset link using nodemailer and local SMTP server
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const link = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const resetTemplate = `
      <html>
        <body>
          <p>Click <a href="<%= resetLink %>">here</a> to reset your password.</p>
        </body>
      </html>`;
    const resetHtml = ejs.render(resetTemplate, {
      resetLink: link
    }, {
      escape: true,
      strict: true
    });
    
    await transporter.sendMail({
      to: user.email,
      subject: 'Your password reset link',
      html: resetHtml
    });
  }

  static async resetPassword(token: string, newPassword: string) {
    const row = await db<UserRow>('users')
      .where('reset_password_token', token)
      .andWhere('reset_password_expires', '>', new Date())
      .first();
    if (!row) throw new Error('Invalid or expired reset token');

    await db('users')
      .where({ id: row.id })
      .update({
        password: newPassword,
        reset_password_token: null,
        reset_password_expires: null
      });
  }

  static async setPassword(token: string, newPassword: string) {
    const row = await db<UserRow>('users')
      .where('invite_token', token)
      .andWhere('invite_token_expires', '>', new Date())
      .first();
    if (!row) throw new Error('Invalid or expired invite token');

    await db('users')
      .update({
        password: newPassword,
        invite_token: null,
        invite_token_expires: null
      })
      .where({ id: row.id });
  }

  static generateJwt(userId: string): string {
    return jwtUtils.generateToken(userId);
  }
}

export default AuthService;
