import { Router } from 'express';
import { getDownloadTicket } from '../services/downloadTicketService.js';
import { recordTransfer } from '../services/historyService.js';

export function createDownloadRouter() {
  const router = Router();

  router.get('/download/:token', (req, res, next) => {
    const ticket = getDownloadTicket(req.params.token);
    res.setHeader('X-Content-SHA256', ticket.sha256);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => {
      if (ticket.recorded) return;
      // 200 = fichier complet ; 206 = plage : le transfert est terminé quand la plage atteint le dernier octet.
      let complete = res.statusCode === 200;
      if (res.statusCode === 206) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(res.getHeader('Content-Range') ?? ''));
        complete = Boolean(match) && Number(match[2]) === Number(match[3]) - 1;
      }
      if (!complete) return;
      ticket.recorded = true;
      recordTransfer({
        direction: 'pc_to_android',
        fileName: ticket.fileName,
        size: ticket.size,
        deviceId: ticket.deviceId,
        deviceName: ticket.deviceName,
        status: 'completed',
      }).catch((error) => console.error('Historique non enregistré :', error));
    });
    res.download(ticket.filePath, ticket.fileName, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });

  return router;
}
