/**
 * @fileoverview Additional VK event handlers for reply edit/delete events
 */

/**
 * Handles wall_reply_edit events (when a comment is edited)
 */
function handleWallReplyEdit(payload) {
  const comment = payload.object || {};
  const commentId = comment.id;
  const postId = comment.post_id;
  const postOwnerId = comment.post_owner_id;
  const postKey = `${postOwnerId}_${postId}`;
  
  Monitoring.recordEvent('REPLY_EDIT_RECEIVED', { 
    comment_id: commentId, 
    post_key: postKey, 
    new_text: comment.text 
  });
  
  // Find the corresponding bid in the Bids sheet
  const bids = getSheetData("Bids");
  const bidToUpdate = bids.find(b => b.data.comment_id == commentId);
  
  if (bidToUpdate) {
    // Parse the new bid amount from the edited comment
    const newBidAmount = parseBid(comment.text || "");
    
    if (newBidAmount) {
      // Update the bid amount in the sheet SAFELY
      const bids = getSheetData("Bids");
      const currentBid = bids.find(b => String(b.data.bid_id) === String(bidToUpdate.data.bid_id));
      if (currentBid) {
        updateRow("Bids", currentBid.rowIndex, { 
          bid_amount: newBidAmount,
          timestamp: new Date()
        });
      }
      
      Monitoring.recordEvent('BID_UPDATED_AFTER_EDIT', { 
        bid_id: bidToUpdate.data.bid_id,
        old_amount: bidToUpdate.data.bid_amount,
        new_amount: newBidAmount,
        comment_id: commentId
      });
      
      // Potentially update the lot if this bid was the current highest
      updateLotAfterBidEdit(bidToUpdate.data.lot_id, newBidAmount);
    } else {
      // If the edited comment is no longer a valid bid, mark it as invalid SAFELY
      updateBidStatus(bidToUpdate.data.bid_id, "invalidated_by_edit");
      
      Monitoring.recordEvent('BID_INVALIDATED_BY_EDIT', { 
        bid_id: bidToUpdate.data.bid_id,
        comment_id: commentId,
        reason: "edited_comment_no_longer_valid_bid"
      });
    }
  }
}

/**
 * Handles wall_reply_delete events (when a comment is deleted)
 */
function handleWallReplyDelete(payload) {
  const commentId = payload.object.comment_id;
  const postId = payload.object.post_id;
  const postOwnerId = payload.object.post_owner_id;
  const postKey = `${postOwnerId}_${postId}`;
  
  Monitoring.recordEvent('REPLY_DELETE_RECEIVED', { 
    comment_id: commentId, 
    post_key: postKey 
  });
  
  // Find the corresponding bid in the Bids sheet
  const bids = getSheetData("Bids");
  const bidToDelete = bids.find(b => b.data.comment_id == commentId);
  
  if (bidToDelete) {
    // Mark the bid as deleted SAFELY
    updateBidStatus(bidToDelete.data.bid_id, "deleted");
    
    Monitoring.recordEvent('BID_MARKED_AS_DELETED', { 
      bid_id: bidToDelete.data.bid_id,
      comment_id: commentId,
      lot_id: bidToDelete.data.lot_id
    });
    
    // Potentially update the lot if this was the current highest bid
    updateLotAfterBidDelete(bidToDelete.data.lot_id, bidToDelete.data.bid_amount);
  }
}

/**
 * Updates the lot after a bid has been edited
 */
function updateLotAfterBidEdit(lotId, newBidAmount) {
  // Get all valid bids for this lot (not deleted/invalidated)
  const allBids = getSheetData("Bids");
  const lotBids = allBids.filter(b => 
    b.data.lot_id == lotId && 
    b.data.status !== "deleted" && 
    b.data.status !== "invalidated_by_edit"
  );
  
  if (lotBids.length === 0) return;
  
  // Find the highest valid bid
  const highestBid = lotBids.reduce((max, bid) => 
    Number(bid.data.bid_amount) > Number(max.data.bid_amount) ? bid : max
  );
  
  // Update the lot with the new highest bid information
  const lot = findLotByLotId(lotId);
  if (lot && Number(highestBid.data.bid_amount) !== Number(lot.current_price)) {
    updateLot(lotId, { 
      current_price: highestBid.data.bid_amount,
      leader_id: highestBid.data.user_id
    });
    
    Monitoring.recordEvent('LOT_UPDATED_AFTER_BID_EDIT', {
      lot_id: lotId,
      new_price: highestBid.data.bid_amount,
      new_leader: highestBid.data.user_id
    });
  }
}

/**
 * Updates the lot after a bid has been deleted
 */
function updateLotAfterBidDelete(lotId, deletedBidAmount) {
  // Get all valid bids for this lot (not deleted/invalidated)
  const allBids = getSheetData("Bids");
  const lotBids = allBids.filter(b => 
    b.data.lot_id == lotId && 
    b.data.status !== "deleted" && 
    b.data.status !== "invalidated_by_edit"
  );
  
  // If no bids left, reset to start price
  if (lotBids.length === 0) {
    const lot = findLotByLotId(lotId);
    if (lot) {
      updateLot(lotId, { 
        current_price: lot.start_price,
        leader_id: ""
      });
      
      Monitoring.recordEvent('LOT_RESET_AFTER_ALL_BIDS_DELETED', {
        lot_id: lotId,
        reset_to_start_price: lot.start_price
      });
    }
    return;
  }
  
  // Find the highest valid bid among remaining bids
  const highestBid = lotBids.reduce((max, bid) => 
    Number(bid.data.bid_amount) > Number(max.data.bid_amount) ? bid : max
  );
  
  // Update the lot with the new highest bid information
  const lot = findLotByLotId(lotId);
  if (lot && Number(highestBid.data.bid_amount) !== Number(lot.current_price)) {
    updateLot(lotId, { 
      current_price: highestBid.data.bid_amount,
      leader_id: highestBid.data.user_id
    });
    
    Monitoring.recordEvent('LOT_UPDATED_AFTER_BID_DELETE', {
      lot_id: lotId,
      new_price: highestBid.data.bid_amount,
      new_leader: highestBid.data.user_id
    });
  }
}

/**
 * Helper function to find a lot by its ID (since findLotByPostId exists but not by lot_id)
 */
function findLotByLotId(lotId) {
  const rows = getSheetData("Config");
  const match = rows.find(r => String(r.data.lot_id) === String(lotId));
  return match ? match.data : null;
}