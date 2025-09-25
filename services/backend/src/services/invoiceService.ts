// src/services/invoiceService.ts
import db from '../db';
import { Invoice } from '../types/invoice';
import axios from 'axios';
import { promises as fs } from 'fs';
import * as path from 'path';

interface InvoiceRow {
  id: string;
  userId: string;
  amount: number;
  dueDate: Date;
  status: string;
}

// registry mínimo — pon acá los proveedores reales que uses en el práctico
const PAYMENT_PROVIDERS: Record<string, { url: string }> = {
  stripe: { url: 'https://payments.stripe.example' },
  acme:   { url: 'https://payments.acme-example.com' },
  // si en el práctico sólo necesitas uno, pon sólo ese
};

class InvoiceService {
  static async list( userId: string, status?: string, operator?: string): Promise<Invoice[]> {
    let q = db<InvoiceRow>('invoices').where({ userId: userId });
    if (status) q = q.andWhereRaw(" status "+ operator + " '"+ status +"'");
    const rows = await q.select();
    const invoices = rows.map(row => ({
      id: row.id,
      userId: row.userId,
      amount: row.amount,
      dueDate: row.dueDate,
      status: row.status} as Invoice
    ));
    return invoices;
  }

    static async setPaymentCard(
    userId: string,
    invoiceId: string,
    paymentBrand: string,
    ccNumber: string,
    ccv: string,
    expirationDate: string
  ) {
    const provider = PAYMENT_PROVIDERS[paymentBrand];
    if (!provider) {
      throw new Error('Unknown payment provider');
    }

    const url = `${provider.url}/payments`;

    const axiosConfig = {
      timeout: 5000,
      maxRedirects: 0,
      validateStatus: (s: number) => s >= 200 && s < 300,
    };

    const paymentResponse = await axios.post(
      url,
      { ccNumber, ccv, expirationDate },
      axiosConfig
    );

    if (!paymentResponse || paymentResponse.status !== 200) {
      throw new Error('Payment failed');
    }

    await db('invoices')
      .where({ id: invoiceId, userId })
      .update({ status: 'paid' });
  }

  static async getInvoice(invoiceId: string, userId: string): Promise<Invoice> {
  const invoice = await db<InvoiceRow>('invoices')
    .where({ id: invoiceId, userId }) // ahora filtra por el dueño
    .first();

  if (!invoice) {
    throw new Error('Invoice not found or access denied');
  }

  return invoice as Invoice;
}


  static async getReceipt(
    invoiceId: string,
    pdfName: string
  ) {
    // check if the invoice exists
    const invoice = await db<InvoiceRow>('invoices').where({ id: invoiceId }).first();
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    try {
      const filePath = `/invoSices/${pdfName}`;
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      // send the error to the standard output
      console.error('Error reading receipt file:', error);
      throw new Error('Receipt not found');

    } 

  };

};

export default InvoiceService;
