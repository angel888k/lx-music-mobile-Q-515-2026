#import "LXSharedIRConvolutionBridge.h"
#include "LXSharedIRConvolutionKernel.hpp"

@implementation LXSharedIRConvolutionBridge {
  std::unique_ptr<LXSharedDSP::IRConvolutionKernel> _kernel;
}

- (instancetype)initWithIRChannels:(NSArray<NSArray<NSNumber *> *> *)irChannels
                     inputChannels:(NSUInteger)inputChannels
                    outputChannels:(NSUInteger)outputChannels
                         blockSize:(NSUInteger)blockSize
                           dryGain:(float)dryGain
                           wetGain:(float)wetGain {
  self = [super init];
  if (self == nil) return nil;

  std::vector<std::vector<float>> channels;
  channels.reserve(irChannels.count);
  for (NSArray<NSNumber *> *channel in irChannels) {
    std::vector<float> values;
    values.reserve(channel.count);
    for (NSNumber *sample in channel) values.push_back(sample.floatValue);
    channels.push_back(std::move(values));
  }

  _kernel = std::make_unique<LXSharedDSP::IRConvolutionKernel>(channels, inputChannels, outputChannels, dryGain, wetGain, blockSize);
  return self;
}

- (BOOL)isReady {
  return _kernel != nullptr && _kernel->isReady();
}

- (void)updateDryGain:(float)dryGain wetGain:(float)wetGain {
  if (_kernel == nullptr) return;
  _kernel->updateGains(dryGain, wetGain);
}

- (void)processStereoChannel0:(float * _Nonnull)channel0
                     channel1:(float * _Nullable)channel1
                   frameCount:(NSUInteger)frameCount
               activeChannels:(NSUInteger)activeChannels {
  if (_kernel == nullptr || channel0 == nullptr || activeChannels == 0) return;
  float *channels[2] = { channel0, channel1 };
  _kernel->processPCMChannels(channels, frameCount, activeChannels);
}

@end
