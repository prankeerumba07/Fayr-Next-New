import {
  Body,
  Controller,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MAX_SCREENSHOT_BYTES } from '../storage/storage.service';
import { UploadScreenshotDto } from './dto/upload-screenshot.dto';
import type { ScreenshotUploadResponse } from './screenshot.response';
import {
  ScreenshotVerificationService,
  type UploadedImage,
} from './screenshot.service';

/**
 * The user's screenshot upload — the tier-3, MANUAL evidence path (the on-device
 * scraper is the primary automated path). Authenticated and scoped to the
 * caller's OWN task: a task that isn't theirs reads as 404. The upload is stored
 * privately (never a public /uploads URL — it's PII) and filed as a PENDING case
 * for staff review; nothing here advances the task or moves money.
 */
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class ScreenshotController {
  constructor(private readonly service: ScreenshotVerificationService) {}

  @Post(':id/screenshot')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadScreenshotDto,
    @UploadedFile(
      new ParseFilePipe({
        // A missing file, an oversized one, or a non-image is a 400 with a clear
        // message — not a 500.
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_SCREENSHOT_BYTES }),
          // Magic-number check by default; `fallbackToMimetype` degrades to the
          // declared type only when detection can't run (e.g. the `file-type` ESM
          // module under Jest) — a disguised binary is still detected + rejected.
          new FileTypeValidator({
            fileType: /^image\/(png|jpe?g|webp)$/,
            fallbackToMimetype: true,
          }),
        ],
      }),
    )
    file: UploadedImage,
  ): Promise<ScreenshotUploadResponse> {
    return this.service.uploadForUser(user.id, id, dto.kind, file);
  }

  /** The caller's own screenshots for this task — status + staff reason (when rejected / needs_more). */
  @Get(':id/screenshots')
  listScreenshots(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ScreenshotUploadResponse[]> {
    return this.service.listForUser(user.id, id);
  }
}
