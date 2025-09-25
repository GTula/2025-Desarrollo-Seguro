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

class InvoiceService {
  static async list( userId: string, status?: string, operator?: string): Promise<Invoice[]> {
    let q = db<InvoiceRow>('invoices').where({ userId: userId });
    // if (status) q = q.andWhereRaw(" status "+ operator + " '"+ status +"'"); // posible sql injection!!!
    
    if (status) {
      const allowedOps: Set<string> = new Set(['=', '<', '>', '<=', '>=']); 
      if (!operator || !allowedOps.has(operator)) {
        throw new Error('Operador no permitido');
      }
      
      q = q.andWhere('status', operator as any, status);
    }

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
    // use axios to call http://paymentBrand/payments as a POST request
    // with the body containing ccNumber, ccv, expirationDate
    // and handle the response accordingly
    const paymentResponse = await axios.post(`http://${paymentBrand}/payments`, {
      ccNumber,
      ccv,
      expirationDate
    });
    if (paymentResponse.status !== 200) {
      throw new Error('Payment failed');
    }

    // Update the invoice status in the database
    await db('invoices')
      .where({ id: invoiceId, userId })
      .update({ status: 'paid' });  
    };
  static async  getInvoice( invoiceId:string): Promise<Invoice> {
    const invoice = await db<InvoiceRow>('invoices').where({ id: invoiceId }).first();
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    return invoice as Invoice;
  }


  static async getReceipt(invoiceId: string, pdfName: string) {
    const invoice = await db<InvoiceRow>('invoices').where({ id: invoiceId }).first();
    if (!invoice) throw new Error('Invoice not found');

    const baseDir = '/invoices';
    const safePath = path.resolve(baseDir, pdfName);

    if (!safePath.startsWith(path.resolve(baseDir))) {
      throw new Error('Acceso no autorizado al sistema de archivos');
    }

    const content = await fs.readFile(safePath, 'utf-8');
    return content;
  }


};

export default InvoiceService;
